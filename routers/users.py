"""
Users — management, notifications, CSAT, GDPR router.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text
from datetime import datetime, timedelta
from typing import Optional
import json, uuid, os, re, io, csv, threading

# Import everything from shared utilities (avoids circular import with main.py)
from shared import (
    # Database
    get_db, SessionLocal,
    # Auth dependencies
    get_current_user, get_current_admin_user, has_permission, Permission,
    oauth2_scheme, OAuth2PasswordRequestForm,
    # Models - SQLAlchemy
    User, Tenant, Ticket, Comment, Notification, KBArticle, Asset,
    ChangeRequest, SystemAuditLog, TicketAuditLog, Macro, AutomationRule,
    EscalationRule, Group, CustomField, TicketTemplate, ApprovalWorkflow,
    ServiceCatalogItem, CannedResponse, TicketView, TicketTask, Attachment,
    # Pydantic models
    TicketCreate, TicketUpdate, TicketOut, CommentCreate, CommentOut,
    KBArticleCreate, KBArticleUpdate, KBArticleOut,
    AssetCreate, AssetUpdate, AssetOut, LinkAssetRequest,
    UserOut, UserCreate, UserInvite, UserUpdate, UserProfileUpdate, PasswordUpdate,
    CannedResponseCreate, CannedResponseUpdate, CannedResponseOut,
    ChangeCreate, ChangeUpdate, ChangeOut,
    ServiceCatalogItemCreate, ServiceCatalogItemOut,
    BulkTicketAction, InboundEmail, CSATSubmit, CSATStats, AttachmentOut,
    SignupRequest, TenantOut, CustomRoleCreate, CustomRoleOut,
    # Email & notifications
    get_email_config, send_email, send_email_background, send_notification,
    create_notification, build_html_email, translate_email,
    # Ticket helpers
    log_ticket_event, _ticket_tenant_filter, compute_sla_deadlines,
    pause_sla, resume_sla, get_sla_rules, compute_sla_status,
    run_automation_rules, trigger_approval_workflow,
    # User helpers
    get_plan_limits, get_user_language, check_tenant_limit, check_user_limit,
    plan_requires, get_trial_status, validate_password_strength,
    # Auth helpers
    get_password_hash, verify_password, create_access_token,
    create_access_token_with_expiry, decode_access_token,
    check_ip_rate_limit, log_system_event,
    # MFA/TOTP
    generate_totp_secret, totp_provisioning_uri, verify_totp,
    generate_backup_codes,
    # File/media
    upload_to_cloudinary, get_signed_url,
    # Business hours & SLA
    get_business_hours_config, add_business_hours,
    # Audit
    _sql_safe_search, _cr_to_out, _safe_json,
    _asset_to_out, _ticket_to_out, _catalog_to_out, _change_to_out,
    _notify_watchers, _round_robin_assign, _user_wants_notif,
    # Rate limiting
    limiter, Limiter, get_remote_address,
    # Constants
    API_URL, FRONTEND_URL, SECRET_KEY, ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES, MAX_FAILED_ATTEMPTS,
    PLAN_LIMITS, SLA_RULES,
)

router = APIRouter()


@router.get("/users/")
def list_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all active users in the tenant. Accessible to agents and admins."""
    if current_user.role not in ['agent', 'admin', 'super_admin', 'platform_admin']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    users = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.is_active == True
    ).all()
    return [{
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": str(u.role) if hasattr(u.role, 'value') else str(u.role),
        "is_active": u.is_active,
        "job_title": u.job_title,
        "department": u.department,
        "profile_photo": u.profile_photo,
        "availability": u.availability or "online",
        "created_at": str(u.created_at) if u.created_at else None,
    } for u in users]


@router.get("/users/me")
def read_users_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    role = (current_(user.role.value if hasattr(user.role, "value") else str(user.role)) if hasattr(current_user.role, "value") else str(current_user.role)) if hasattr(current_user.role, 'value') else str(current_user.role)

    # Super admin gets all features unlocked regardless of plan
    if role in ('super_admin', 'platform_admin'):
        limits = get_plan_limits('enterprise')
    else:
        limits = get_plan_limits(tenant.plan if tenant else 'free')

    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": role,
        "is_active": current_user.is_active,
        "language": current_user.language or "en",
        "theme": current_user.theme or "light",
        "profile_photo": current_user.profile_photo,
        "created_at": current_user.created_at,
        "plan_limits": limits,
        "branding": {
            "company_name": tenant.name if tenant else "ITSM Portal",
            "company_tagline": tenant.company_tagline if tenant else None,
            "primary_color": tenant.primary_color if tenant else "#4f46e5",
            "accent_color": tenant.accent_color if tenant else "#818cf8",
            "logo_url": tenant.logo_url if tenant else None,
            "support_email": tenant.support_email if tenant else None,
            "plan_limits": limits,
        } if tenant else None,
    }

# ---------- Tickets (tenant‑scoped + permissions + QUICK FILTERS + CSAT) ----------
def _round_robin_assign(tenant_id: int, group_id: int | None, db) -> int | None:
    """Round-robin auto-assignment.
    Finds the active agent (or agent in the specified group) who was assigned
    a ticket least recently — ensuring even distribution across the team.
    Returns the user_id to assign to, or None if no agents available.
    """
    # Base query — active agents/admins in this tenant
    agent_query = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.is_active == True,
        User.role.in_(['agent', 'admin']),
    )

    if group_id:
        # Restrict to agents in the specified group
        group_member_ids = db.query(GroupMember.user_id).filter(
            GroupMember.group_id == group_id
        ).subquery()
        agent_query = agent_query.filter(User.id.in_(group_member_ids))

    agents = agent_query.all()
    if not agents:
        return None

    agent_ids = [a.id for a in agents]

    # Find last assignment time for each agent
    from sqlalchemy import func as _func
    last_assignments = db.query(
        Ticket.assigned_to_id,
        _func.max(Ticket.created_at).label("last_assigned_at")
    ).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.assigned_to_id.in_(agent_ids),
    ).group_by(Ticket.assigned_to_id).all()

    # Build a map of agent_id → last assigned time
    last_map = {row.assigned_to_id: row.last_assigned_at for row in last_assignments}

    # Sort agents: those never assigned first (None → earliest), then by oldest assignment
    agents_sorted = sorted(
        agents,
        key=lambda a: last_map.get(a.id) or datetime.min
    )

    selected = agents_sorted[0]
    print(f"✅ Round-robin assigned ticket to {selected.full_name} (id={selected.id})")
    return selected.id


def _ticket_tenant_filter(query, ticket_id: int, current_user):
    """Filter ticket by ID, allowing platform_admin to access any tenant."""
    role = str(current_user.role)
    if role in ("platform_admin", "super_admin"):
        return query.filter(Ticket.id == ticket_id)
    return query.filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id)



@router.get("/notifications/")
def list_notifications(
    unread_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.tenant_id == current_user.tenant_id
    )
    if unread_only:
        query = query.filter(Notification.is_read == False)
    total = query.count()
    unread_count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).count()
    items = query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [{"id": n.id, "type": n.type, "title": n.title, "body": n.body,
                   "link": n.link, "is_read": n.is_read, "created_at": n.created_at} for n in items],
        "total": total,
        "unread_count": unread_count
    }


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_user)):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}



@router.post("/users/me/request-email-change")
def request_email_change(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Step 1: user requests an email address change.
    Sends a confirmation link to the NEW email — existing email stays active until confirmed.
    """
    new_email = data.get("email", "").strip().lower()
    if not new_email:
        raise HTTPException(status_code=400, detail="Email address is required.")
    if new_email == current_user.email:
        raise HTTPException(status_code=400, detail="This is already your current email address.")
    # Check new email isn't taken by another account
    existing = db.query(User).filter(User.email == new_email, User.id != current_user.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="That email address is already in use by another account.")

    # Generate a confirmation token
    token = uuid.uuid4().hex
    current_user.pending_email = new_email
    current_user.email_change_token = token
    current_user.email_change_expires_at = datetime.utcnow() + timedelta(hours=24)
    db.commit()

    confirm_url = f"{FRONTEND_URL}/confirm-email-change?token={token}"
    send_email_background(
        to=new_email,
        subject="Confirm your new email address for DodoDesk",
        body=(
            f"Hi {current_user.full_name},\n\n"
            f"You requested to change your DodoDesk login email to this address.\n\n"
            f"Click the link below to confirm. Your current email ({current_user.email}) "
            f"will remain active until you confirm.\n\n"
            f"{confirm_url}\n\n"
            f"This link expires in 24 hours. If you did not request this change, "
            f"you can safely ignore this email — your account is not affected."
        ),
        cta_url=confirm_url,
        cta_label="Confirm New Email Address",
    )
    return {"ok": True, "message": f"A confirmation link has been sent to {new_email}. "
                                    f"Your current email remains active until you confirm."}


@router.post("/users/me/cancel-email-change")
def cancel_email_change(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cancel a pending email change request."""
    current_user.pending_email = None
    current_user.email_change_token = None
    current_user.email_change_expires_at = None
    db.commit()
    return {"ok": True, "message": "Email change cancelled."}


@router.patch("/users/me/availability")
def update_availability(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update agent availability status — online | busy | away | offline."""
    status = data.get("availability", "online")
    if status not in ["online", "busy", "away", "offline"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    current_user.availability = status
    db.commit()
    return {"ok": True, "availability": status}


@router.get("/users/availability")
def list_team_availability(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lightweight endpoint — returns availability status for all active agents/admins in the tenant.
    Used for the team availability panel and refreshed periodically."""
    if str(current_user.role) not in ["agent", "admin", "super_admin", "platform_admin"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    users = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.is_active == True,
        User.role.in_(['agent', 'admin', 'super_admin', 'platform_admin'])
    ).all()
    order = {"online": 0, "busy": 1, "away": 2, "offline": 3}
    items = sorted(
        [{"id": u.id, "full_name": u.full_name, "profile_photo": u.profile_photo,
          "availability": u.availability or "online"} for u in users],
        key=lambda u: order.get(u["availability"], 4)
    )
    return items


@router.get("/users/me/notification-prefs")
def get_notification_prefs(current_user: User = Depends(get_current_user)):
    default_prefs = {
        "ticket_assigned": True,
        "ticket_commented": True,
        "ticket_status_changed": True,
        "ticket_sla_breach": True,
        "ticket_mentioned": True,
        "change_approved": True,
        "change_rejected": True,
        "email_ticket_assigned": True,
        "email_ticket_commented": True,
        "email_sla_breach": True,
    }
    if current_user.notification_prefs:
        try:
            stored = json.loads(current_user.notification_prefs)
            return {**default_prefs, **stored}
        except Exception:
            pass
    return default_prefs


@router.put("/users/me/notification-prefs")
def update_notification_prefs(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Re-query user within this db session to avoid detached instance error
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.notification_prefs = json.dumps(data)
    db.commit()
    return {"ok": True, "saved": True}


def _user_wants_notif(db, user_id: int, event_key: str) -> bool:
    """Check if user has enabled a notification event. Defaults to True if not set."""
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.notification_prefs:
            return True
        prefs = json.loads(user.notification_prefs)
        return prefs.get(event_key, True)
    except Exception:
        return True



@router.put("/users/me/password")
def change_password(
    pwd: PasswordUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(pwd.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    validate_password_strength(pwd.new_password)
    current_user.hashed_password = get_password_hash(pwd.new_password)
    db.commit()
    return {"detail": "Password updated successfully"}



@router.get("/users/me/mfa/status")
def mfa_status(current_user: User = Depends(get_current_user)):
    return {
        "mfa_enabled": bool(current_user.mfa_enabled),
        "backup_codes_remaining": len(json.loads(current_user.mfa_backup_codes or "[]")),
    }


@router.post("/users/me/mfa/setup")
def mfa_setup(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Step 1: generate a new secret and return QR provisioning URI + base64 QR image. Not yet enabled until confirmed."""
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled. Disable it first to re-enroll.")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if tenant and not get_plan_limits(tenant.plan)["mfa"]:
        raise HTTPException(status_code=403, detail="Two-factor authentication is available on the Pro plan and above. Please upgrade your plan.")
    secret = generate_totp_secret()
    current_user.mfa_secret = secret  # stored but mfa_enabled stays False until confirmed
    db.commit()
    uri = totp_provisioning_uri(secret, current_user.email, issuer="DodoDesk")
    # Generate QR code as base64 data URL — no external API calls needed
    qr_data_url = None
    try:
        import qrcode, base64, io
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,  # Medium — more reliable scanning
            box_size=10,
            border=4,
        )
        qr.add_data(uri)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        qr_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        print(f"✅ MFA QR generated for {current_user.email}, URI length: {len(uri)}")
    except Exception as e:
        print(f"❌ QR generation failed: {type(e).__name__}: {e}")
        # qr_data_url stays None — frontend shows manual key entry fallback
    return {"secret": secret, "provisioning_uri": uri, "qr_data_url": qr_data_url}


@router.post("/users/me/mfa/confirm")
def mfa_confirm(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Step 2: user enters the 6-digit code from their app to confirm and enable MFA."""
    code = data.get("code", "")
    if not current_user.mfa_secret:
        raise HTTPException(status_code=400, detail="No MFA setup in progress. Call /mfa/setup first.")
    if not verify_totp(current_user.mfa_secret, code):
        raise HTTPException(status_code=400, detail="Invalid code. Please try again.")
    backup_codes = generate_backup_codes()
    current_user.mfa_enabled = True
    current_user.mfa_backup_codes = json.dumps(backup_codes)
    log_system_event(db, current_user, "user.mfa_enabled",
                     target_type="user", target_id=current_user.id, target_label=current_user.email)
    db.commit()
    return {"ok": True, "backup_codes": backup_codes}


@router.post("/users/me/mfa/disable")
def mfa_disable(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Disable MFA — requires current password for security."""
    password = data.get("password", "")
    if not verify_password(password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password.")
    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    current_user.mfa_backup_codes = None
    log_system_event(db, current_user, "user.mfa_disabled",
                     target_type="user", target_id=current_user.id, target_label=current_user.email)
    db.commit()
    return {"ok": True}


@router.post("/users/me/photo")
def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="Only PNG, JPG, or JPEG images are allowed")

    file_bytes = file.file.read()

    if CLOUDINARY_CLOUD_NAME:
        public_id = f"user_{current_user.id}_avatar{ext}"
        photo_url = upload_to_cloudinary(file_bytes, public_id,
            folder=_cloudinary_folder(current_user.tenant_id, "avatars"),
            filename=file.filename)
        current_user.profile_photo = photo_url
    else:
        # Fallback to local storage
        unique_name = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(AVATAR_DIR, unique_name)
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        if current_user.profile_photo and not current_user.profile_photo.startswith('http'):
            old_path = os.path.join(AVATAR_DIR, current_user.profile_photo)
            if os.path.exists(old_path):
                os.remove(old_path)
        current_user.profile_photo = unique_name

    db.commit()
    return {"detail": "Photo updated"}


@router.get("/users/me/photo")
def get_profile_photo(current_user: User = Depends(get_current_user)):
    """Returns a 1-hour signed URL for the user's profile photo.
    The URL is time-limited — Cloudinary enforces expiry server-side.
    """
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No photo")
    photo = current_user.profile_photo
    # If it's a Cloudinary public_id (stored after auth migration), sign it
    if photo and not photo.startswith("/") and not photo.startswith("http"):
        ext = os.path.splitext(photo)[1].lower()
        rtype = "image" if ext in {".png",".jpg",".jpeg",".gif",".webp",".svg"} else "raw"
        signed = get_signed_url(photo, resource_type=rtype)
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=signed)
    # Legacy local file
    if photo.startswith("http"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=photo)
    file_path = os.path.join(AVATAR_DIR, photo)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(file_path, media_type="image/jpeg")


@router.get("/users/{user_id}/photo")
def get_user_photo(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns a signed URL redirect for any user's profile photo within the same tenant."""
    user = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == current_user.tenant_id
    ).first()
    if not user or not user.profile_photo:
        raise HTTPException(status_code=404, detail="No photo")
    photo = user.profile_photo
    if photo.startswith("http"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=photo)
    ext = os.path.splitext(photo)[1].lower()
    rtype = "image" if ext in {".png",".jpg",".jpeg",".gif",".webp",".svg"} else "raw"
    signed = get_signed_url(photo, resource_type=rtype)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=signed)


@router.get("/users/me/photo-url")
def get_profile_photo_url(current_user: User = Depends(get_current_user)):
    """Returns a signed URL for the profile photo — for direct use in <img src>."""
    if not current_user.profile_photo:
        return {"url": None}
    photo = current_user.profile_photo
    if photo.startswith("http"):
        return {"url": photo}
    signed = get_signed_url(photo, resource_type="image")
    return {"url": signed, "expires_in": 3600}



@router.post("/users/me/request-deletion")
def request_account_deletion(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """GDPR Art. 17 — Right to Erasure.

    IMPORTANT B2B GDPR DISTINCTION:
    - If the user is an admin/owner of their own tenant → DodoBay handles directly.
    - If the user is an employee/agent of a company tenant → the company (Controller)
      must handle the request. DodoBay notifies the tenant admin and forwards the request.
      DodoBay is a processor in this case and cannot act without Controller instruction.
    """
    reason = data.get("reason", "").strip()
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    tenant_name = tenant.name if tenant else f"Tenant {current_user.tenant_id}"

    # Find the tenant's admin/owner (the Data Controller)
    tenant_admin = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.role == 'admin',
        User.is_active == True,
        User.id != current_user.id,
    ).first()

    is_own_account = current_user.role in ("admin", "super_admin", "platform_admin")

    if is_own_account:
        # User is the account owner — DodoBay handles directly
        send_email_background(
            to="privacy@dodobay.com",
            subject=f"[GDPR] Account deletion request — {current_user.email}",
            body=(
                f"Account owner has requested deletion.\n\n"
                f"User: {current_user.full_name} ({current_user.email})\n"
                f"Role: {(current_(user.role.value if hasattr(user.role, "value") else str(user.role)) if hasattr(current_user.role, "value") else str(current_user.role))}\n"
                f"Tenant: {tenant_name} (ID: {current_user.tenant_id})\n"
                f"Reason: {reason or 'Not provided'}\n"
                f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"Action required: Delete tenant data within 30 days per GDPR Art. 17."
            ),
        )
        user_message = (
            "Your deletion request has been received. As the account owner, "
            "we will delete your account and all associated data within 30 days. "
            "You will receive a confirmation email."
        )
    else:
        # User is an employee — notify their employer (the Controller)
        # DodoBay forwards the request but cannot act without Controller instruction
        if tenant_admin:
            send_email_background(
                to=tenant_admin.email,
                subject=f"[GDPR] Employee data deletion request — {current_user.full_name}",
                body=(
                    f"One of your team members has submitted a GDPR erasure request.\n\n"
                    f"Employee: {current_user.full_name} ({current_user.email})\n"
                    f"Reason: {reason or 'Not provided'}\n"
                    f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                    f"As the data controller for your organisation's DodoDesk account, "
                    f"you are responsible for responding to this request within 30 days "
                    f"under GDPR Article 17.\n\n"
                    f"To delete this user's account: log in to DodoDesk → Users → "
                    f"find {current_user.full_name} → Delete.\n\n"
                    f"If you have questions, contact us at privacy@dodobay.com."
                ),
            )
        # Also notify DodoBay for our records
        send_email_background(
            to="privacy@dodobay.com",
            subject=f"[GDPR] Employee erasure request forwarded — {current_user.email}",
            body=(
                f"An employee erasure request has been forwarded to their employer.\n\n"
                f"Employee: {current_user.full_name} ({current_user.email})\n"
                f"Employer/Tenant: {tenant_name} (ID: {current_user.tenant_id})\n"
                f"Tenant admin notified: {tenant_admin.email if tenant_admin else 'None found'}\n"
                f"Reason: {reason or 'Not provided'}\n"
                f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"Note: DodoBay is the processor in this case. The employer is the Controller "
                f"and must instruct DodoBay if deletion is to proceed."
            ),
        )
        user_message = (
            "Your request has been received and forwarded to your organisation's administrator. "
            "Under GDPR, your employer (as the data controller) is responsible for responding "
            "to your request within 30 days. If you do not receive a response, you may contact "
            "your national data protection authority."
        )

    # Send confirmation to user
    send_email_background(
        to=current_user.email,
        subject="Your data deletion request has been received — DodoDesk",
        body=(
            f"Hi {current_user.full_name},\n\n"
            f"We have received your request to delete your personal data from DodoDesk.\n\n"
            f"{user_message}\n\n"
            f"For further assistance, contact us at privacy@dodobay.com.\n\n"
            f"— The DodoDesk Team"
        ),
    )

    log_system_event(db, current_user, "user.deletion_requested",
                     target_type="user", target_id=current_user.id,
                     target_label=current_user.email, new_value=reason)
    db.commit()
    return {"ok": True, "message": user_message}


@router.get("/users/me/export")
def export_my_data(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """GDPR Art. 20 — Right to Data Portability.
    Returns all personal data held about the current user in JSON format.
    """
    import io as _io
    # Gather all data about this user
    tickets_raised = db.query(Ticket).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.requester_id == current_user.id
    ).all()
    comments = db.query(Comment).filter(Comment.author_id == current_user.id).all()
    audit = db.query(SystemAuditLog).filter(
        SystemAuditLog.actor_id == current_user.id
    ).limit(500).all()

    export = {
        "export_date": datetime.utcnow().isoformat(),
        "gdpr_article": "Article 20 — Right to Data Portability",
        "personal_data": {
            "id": current_user.id,
            "full_name": current_user.full_name,
            "email": current_user.email,
            "job_title": current_user.job_title,
            "department": current_user.department,
            "phone": current_user.phone,
            "country": getattr(current_user, "country", None),
            "language": current_user.language,
            "timezone": current_user.timezone,
            "role": (current_(user.role.value if hasattr(user.role, "value") else str(user.role)) if hasattr(current_user.role, "value") else str(current_user.role)) if hasattr(current_user.role, "value") else current_user.role,
            "created_at": str(current_user.created_at),
            "email_verified": getattr(current_user, "email_verified", None),
            "mfa_enabled": getattr(current_user, "mfa_enabled", False),
        },
        "tickets_raised": [
            {"id": t.id, "title": t.title, "status": str(t.status) if hasattr(t.status, "value") else t.status,
             "priority": str(t.priority) if hasattr(t.priority, "value") else t.priority,
             "created_at": str(t.created_at)}
            for t in tickets_raised
        ],
        "comments": [
            {"id": c.id, "ticket_id": c.ticket_id, "body": c.body, "created_at": str(c.created_at)}
            for c in comments
        ],
        "audit_log": [
            {"action": a.action, "target_type": a.target_type, "created_at": str(a.created_at)}
            for a in audit
        ],
    }

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=export,
        headers={"Content-Disposition": f'attachment; filename="dododesk_my_data_{current_user.id}.json"'}
    )




@router.get("/csat/{token}")
def get_csat_survey(token: str, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.csat_token == token).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Survey not found")
    return {"id": ticket.id, "title": ticket.title, "rating": ticket.csat_rating, "comment": ticket.csat_comment}


@router.post("/csat/{token}")
def submit_csat_survey(token: str, data: CSATSubmit, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.csat_token == token).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Survey not found")
    if ticket.csat_rating is not None:
        raise HTTPException(status_code=400, detail="Survey already submitted")
    if data.rating < 1 or data.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    ticket.csat_rating = data.rating
    ticket.csat_comment = data.comment
    db.commit()
    return {"detail": "Thank you for your feedback"}
