"""
Authentication — login, register, MFA, SSO, password reset, email verification router.
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


@router.get("/auth/sso/login/{tenant_slug}")
def sso_login(tenant_slug: str, db: Session = Depends(get_db)):
    """Initiate SAML SSO login — redirects user to their IdP."""
    tenant = db.query(Tenant).filter(
        Tenant.slug == tenant_slug,
        Tenant.is_active == True
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if not tenant.sso_enabled:
        raise HTTPException(status_code=400, detail="SSO is not enabled for this organisation")
    if not tenant.sso_client_id:
        raise HTTPException(status_code=400, detail="SSO is not configured. Please contact your administrator.")

    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        from onelogin.saml2.utils import OneLogin_Saml2_Utils
        saml_settings = _get_saml_settings(tenant)

        # Build auth object without a real request (we just need the redirect URL)
        req = {
            "https": "on",
            "http_host": API_URL.replace("https://", "").replace("http://", ""),
            "script_name": f"/auth/sso/login/{tenant_slug}",
            "server_port": "443",
            "get_data": {},
            "post_data": {},
        }
        auth = OneLogin_Saml2_Auth(req, saml_settings)
        redirect_url = auth.login()
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=redirect_url)
    except ImportError:
        raise HTTPException(status_code=500, detail="SAML library not installed. Run: pip install python3-saml")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SSO login error: {str(e)}")



@router.post("/auth/sso/callback/{tenant_slug}")
async def sso_callback(tenant_slug: str, request: Request, db: Session = Depends(get_db)):
    """Receive SAML Response from IdP, validate it, and issue a DodoDesk JWT."""
    tenant = db.query(Tenant).filter(
        Tenant.slug == tenant_slug,
        Tenant.is_active == True
    ).first()
    if not tenant:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=org_not_found")

    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
        form_data = await request.form()
        saml_response = form_data.get("SAMLResponse", "")

        req = {
            "https": "on",
            "http_host": API_URL.replace("https://", "").replace("http://", ""),
            "script_name": f"/auth/sso/callback/{tenant_slug}",
            "server_port": "443",
            "get_data": dict(request.query_params),
            "post_data": {"SAMLResponse": saml_response},
        }

        saml_settings = _get_saml_settings(tenant)
        auth = OneLogin_Saml2_Auth(req, saml_settings)
        auth.process_response()
        errors = auth.get_errors()

        if errors:
            error_msg = auth.get_last_error_reason() or ", ".join(errors)
            print(f"❌ SAML errors for {tenant_slug}: {error_msg}")
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=saml_failed&detail={error_msg[:100]}")

        if not auth.is_authenticated():
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=not_authenticated")

        # Extract user attributes from SAML assertion
        attrs      = auth.get_attributes()
        name_id    = auth.get_nameid()  # usually the email
        email      = (attrs.get("email", [None])[0] or
                      attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", [None])[0] or
                      name_id or "")
        first_name = (attrs.get("firstName", [None])[0] or
                      attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname", [None])[0] or "")
        last_name  = (attrs.get("lastName", [None])[0] or
                      attrs.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname", [None])[0] or "")
        full_name  = f"{first_name} {last_name}".strip() or email.split("@")[0]

        if not email:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=no_email")

        # Restrict to configured SSO domain if set
        if tenant.sso_domain and not email.endswith(f"@{tenant.sso_domain.lstrip('@')}"):
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=domain_mismatch")

        # Find or create user
        user = db.query(User).filter(
            User.email == email.lower(),
            User.tenant_id == tenant.id
        ).first()

        if not user:
            # Auto-provision user on first SSO login
            user = User(
                tenant_id=tenant.id,
                email=email.lower(),
                full_name=full_name,
                hashed_password=get_password_hash(os.urandom(32).hex()),  # random unusable password
                role=UserRole.EMPLOYEE,
                is_active=True,
                email_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            log_system_event(db, user, "user.sso_provisioned",
                             target_type="user", target_id=user.id, target_label=email)
            db.commit()
            print(f"✅ SSO: auto-provisioned user {email} for tenant {tenant.name}")
        elif not user.is_active:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=account_disabled")

        # Update name if changed in IdP
        if full_name and full_name != user.full_name:
            user.full_name = full_name
            db.commit()

        # Issue JWT — single session enforcement
        import uuid as _uuid
        session_id = str(_uuid.uuid4())
        user.current_session_id = session_id
        db.commit()

        access_token = create_access_token({"sub": user.email, "sid": session_id})
        log_system_event(db, user, "user.sso_login",
                         target_type="user", target_id=user.id, target_label=email)
        db.commit()

        print(f"✅ SSO login: {email} → tenant {tenant.name}")

        # Redirect to frontend with token in URL fragment (never in query string)
        from fastapi.responses import RedirectResponse
        return RedirectResponse(
            url=f"{FRONTEND_URL}/sso-callback#token={access_token}&email={email}"
        )

    except Exception as e:
        import traceback; traceback.print_exc()
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=sso_error")



@router.get("/auth/sso/metadata/{tenant_slug}")
def sso_metadata(tenant_slug: str, db: Session = Depends(get_db)):
    """Return SP metadata XML — paste this into your IdP when configuring DodoDesk."""
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Organisation not found")

    try:
        from onelogin.saml2.settings import OneLogin_Saml2_Settings
        from onelogin.saml2.errors import OneLogin_Saml2_Error
        saml_settings = _get_saml_settings(tenant)
        settings_obj  = OneLogin_Saml2_Settings(settings=saml_settings, sp_validation_only=True)
        metadata      = settings_obj.get_sp_metadata()
        from fastapi.responses import Response
        return Response(content=metadata, media_type="application/xml")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not generate metadata: {str(e)}")



@router.get("/auth/sso/check/{email_or_slug}")
def sso_check(email_or_slug: str, db: Session = Depends(get_db)):
    """Check if SSO is enabled for a given email domain or tenant slug.
    Used by the login page to show SSO option automatically.
    """
    # Try by email domain
    if "@" in email_or_slug:
        domain = email_or_slug.split("@")[1].lower()
        tenant = db.query(Tenant).filter(
            Tenant.sso_enabled == True,
            Tenant.sso_domain == domain,
            Tenant.is_active == True
        ).first()
    else:
        # Try by slug
        tenant = db.query(Tenant).filter(
            Tenant.slug == email_or_slug,
            Tenant.sso_enabled == True,
            Tenant.is_active == True
        ).first()

    if tenant:
        provider = tenant.sso_provider or "saml"
        # OAuth providers use /auth/oauth/login, SAML uses /auth/sso/login
        oauth_providers = {"google", "microsoft", "okta"}
        login_url = (f"{API_URL}/auth/oauth/login/{tenant.slug}"
                     if provider in oauth_providers
                     else f"{API_URL}/auth/sso/login/{tenant.slug}")
        return {
            "sso_enabled":  True,
            "tenant_slug":  tenant.slug,
            "tenant_name":  tenant.name,
            "sso_provider": provider,
            "login_url":    login_url,
        }
    return {"sso_enabled": False}


@router.get("/auth/oauth/login/{tenant_slug}")
def oauth_login(tenant_slug: str, db: Session = Depends(get_db)):
    """Initiate OAuth 2.0 / OIDC login for Google, Microsoft, or Okta."""
    tenant = db.query(Tenant).filter(
        Tenant.slug == tenant_slug,
        Tenant.is_active == True
    ).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if not tenant.sso_enabled:
        raise HTTPException(status_code=400, detail="SSO is not enabled for this organisation")

    provider = (tenant.sso_provider or "google").lower()
    if provider not in OAUTH_PROVIDERS:
        # Fall back to SAML
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"{API_URL}/auth/sso/login/{tenant_slug}")

    provider_cfg = OAUTH_PROVIDERS[provider]
    client_id = tenant.sso_client_id or ""
    if not client_id:
        raise HTTPException(status_code=400, detail="OAuth Client ID not configured. Please set it in Settings → Security.")

    # Build auth URL with provider-specific substitutions
    auth_url = provider_cfg["auth_url"]
    if provider == "microsoft":
        tenant_id = tenant.sso_tenant_id or "common"
        auth_url = auth_url.replace("{tenant_id}", tenant_id)
    elif provider == "okta":
        domain = tenant.sso_domain or tenant.sso_tenant_id or ""
        if not domain:
            raise HTTPException(status_code=400, detail="Okta domain not configured (e.g. your-org.okta.com)")
        auth_url = auth_url.replace("{domain}", domain)

    import urllib.parse, secrets
    state = secrets.token_urlsafe(32)
    params = {
        "client_id":     client_id,
        "response_type": "code",
        "redirect_uri":  _get_oauth_redirect_uri(tenant_slug),
        "scope":         provider_cfg["scope"],
        "state":         f"{tenant_slug}:{state}",
        "access_type":   "online",
    }
    if provider == "microsoft":
        params["response_mode"] = "query"

    redirect = f"{auth_url}?{urllib.parse.urlencode(params)}"
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=redirect)



@router.get("/auth/oauth/callback/{tenant_slug}")
async def oauth_callback(
    tenant_slug: str,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db)
):
    """Handle OAuth 2.0 callback — exchange code for token, get user info, issue JWT."""
    from fastapi.responses import RedirectResponse

    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=oauth_{error}")

    tenant = db.query(Tenant).filter(
        Tenant.slug == tenant_slug,
        Tenant.is_active == True
    ).first()
    if not tenant:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=org_not_found")

    provider = (tenant.sso_provider or "google").lower()
    if provider not in OAUTH_PROVIDERS:
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=unsupported_provider")

    provider_cfg  = OAUTH_PROVIDERS[provider]
    client_id     = tenant.sso_client_id or ""
    client_secret = tenant.sso_client_secret or ""
    token_url     = provider_cfg["token_url"]
    userinfo_url  = provider_cfg["userinfo_url"]

    if provider == "microsoft":
        tid = tenant.sso_tenant_id or "common"
        token_url    = token_url.replace("{tenant_id}", tid)
        userinfo_url = userinfo_url  # graph endpoint is fixed
    elif provider == "okta":
        domain = tenant.sso_domain or tenant.sso_tenant_id or ""
        token_url    = token_url.replace("{domain}", domain)
        userinfo_url = userinfo_url.replace("{domain}", domain)

    try:
        import httpx as _httpx

        # Step 1: Exchange authorization code for tokens
        token_resp = _httpx.post(token_url, data={
            "grant_type":   "authorization_code",
            "code":          code,
            "redirect_uri":  _get_oauth_redirect_uri(tenant_slug),
            "client_id":     client_id,
            "client_secret": client_secret,
        }, timeout=15.0)

        if token_resp.status_code != 200:
            print(f"❌ OAuth token exchange failed: {token_resp.status_code} {token_resp.text[:200]}")
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=token_exchange_failed")

        tokens      = token_resp.json()
        access_token = tokens.get("access_token", "")

        # Step 2: Get user info
        userinfo_resp = _httpx.get(userinfo_url, headers={
            "Authorization": f"Bearer {access_token}"
        }, timeout=10.0)

        if userinfo_resp.status_code != 200:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=userinfo_failed")

        user_data = userinfo_resp.json()

        # Normalise across providers
        email = (user_data.get("email") or
                 user_data.get("mail") or
                 user_data.get("preferred_username") or "").lower()
        first = user_data.get("given_name") or user_data.get("givenName") or ""
        last  = user_data.get("family_name") or user_data.get("surname") or ""
        full_name = f"{first} {last}".strip() or email.split("@")[0]

        if not email:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=no_email")

        # Domain restriction
        if tenant.sso_domain and not email.endswith(f"@{tenant.sso_domain.lstrip('@')}"):
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=domain_mismatch")

        # Find or auto-provision user
        db_user = db.query(User).filter(
            User.email == email,
            User.tenant_id == tenant.id
        ).first()

        if not db_user:
            import os as _os
            db_user = User(
                tenant_id=tenant.id,
                email=email,
                full_name=full_name,
                hashed_password=get_password_hash(_os.urandom(32).hex()),
                role=UserRole.EMPLOYEE,
                is_active=True,
                email_verified=True,
            )
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            log_system_event(db, db_user, "user.oauth_provisioned",
                             target_type="user", target_id=db_user.id, target_label=email)
            db.commit()
            print(f"✅ OAuth SSO: auto-provisioned {email} via {provider}")
        elif not db_user.is_active:
            return RedirectResponse(url=f"{FRONTEND_URL}/login?error=account_disabled")

        # Update name if changed
        if full_name and full_name != db_user.full_name:
            db_user.full_name = full_name
            db.commit()

        # Issue JWT
        import uuid as _uuid2
        session_id = str(_uuid2.uuid4())
        db_user.current_session_id = session_id
        db.commit()

        jwt_token = create_access_token({"sub": db_user.email, "sid": session_id})
        log_system_event(db, db_user, "user.oauth_login",
                         target_type="user", target_id=db_user.id, target_label=email)
        db.commit()
        print(f"✅ OAuth login: {email} via {provider} → tenant {tenant.name}")

        return RedirectResponse(
            url=f"{FRONTEND_URL}/sso-callback#token={jwt_token}&email={email}"
        )

    except Exception as e:
        import traceback; traceback.print_exc()
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=oauth_error")



@router.get("/auth/oauth/providers")

@router.post("/auth/forgot-password")
def forgot_password(data: dict, request: Request, db: Session = Depends(get_db)):
    # Simple rate limit: only allow reset if no token issued in last 5 minutes
    _email = (data.get("email") or "").lower().strip()
    from datetime import datetime as _dt, timedelta as _td
    _user_check = db.query(User).filter(User.email == _email).first()
    if _user_check and _user_check.password_reset_expires_at:
        _issued_at = _user_check.password_reset_expires_at - _td(hours=24)
        if _issued_at > _dt.utcnow() - _td(minutes=5):
            raise HTTPException(status_code=429, detail="Reset email already sent. Please wait 5 minutes before requesting again.")
    from sqlalchemy import text as _text
    email = data.get("email", "").lower().strip()
    # Allow locked or inactive users to reset password — account locked ≠ permanently deleted
    # We look for any user with this email (active or locked) so they can regain access
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return {"ok": True, "message": "If that email exists, a reset link has been sent."}
    # Don't allow reset for invited-but-not-yet-activated users — they should use the invite link
    if not user.is_active and user.password_reset_token and user.password_reset_token.startswith("invite_"):
        return {"ok": True, "message": "If that email exists, a reset link has been sent."}

    token    = uuid.uuid4().hex
    reset_val = f"reset_{token}"
    expires_at = datetime.utcnow() + timedelta(hours=1)

    # Store token with expiry — use raw SQL for reliability
    try:
        with db.bind.connect() as conn:
            conn.execute(
                _text("UPDATE users SET password_reset_token = :tok, password_reset_expires_at = :exp WHERE id = :uid"),
                {"tok": reset_val, "uid": user.id, "exp": expires_at}
            )
            conn.commit()
        print(f"✅ Reset token stored for {user.email[:3]}***")
    except Exception as e:
        print(f"❌ Failed to store reset token: {e}")
        raise HTTPException(status_code=500, detail="Could not generate reset token.")

    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"

    # Send via Resend in background thread — returns immediately
    import threading
    _email = user.email
    _name  = user.full_name
    _url   = reset_url
    _key   = RESEND_API_KEY
    _from  = RESEND_FROM
    # Fetch super admin branding for email
    try:
        _super = db.query(Tenant).filter(Tenant.id == 1).first()
        _logo  = _super.logo_url if _super else None
        _color = _super.primary_color if _super else "#4f46e5"
        _cname = _super.name if _super else "DodoDesk"
    except Exception:
        _logo = None; _color = "#4f46e5"; _cname = "DodoDesk"

    send_email_background(
        to=_email,
        subject="Reset your DodoDesk password",
        body=(
            f"Hi {_name},\n\n"
            f"You requested a password reset. Click the link below to set a new password:\n\n"
            f"{_url}\n\n"
            f"This link expires in 1 hour. If you didn't request this, you can safely ignore this email."
        ),
        cta_url=_url,
        cta_label="Reset My Password",
    )
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


@router.post("/auth/reset-password")
def reset_password(data: dict, db: Session = Depends(get_db)):
    import traceback
    from sqlalchemy import text as _text
    token        = data.get("token", "")
    new_password = data.get("new_password", "")
    print(f"🔑 reset_password called token_len={len(token)}")

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")

    # Accept either a forgot-password reset token or an invite token —
    # both are stored the same way, just with a different prefix so we know
    # whether to also activate the account (invites) or leave status untouched (resets).
    reset_val = f"reset_{token}"
    invite_val = f"invite_{token}"

    try:
        # Step 1 — ensure column exists
        try:
            with db.bind.connect() as conn:
                conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR"))
                conn.commit()
        except Exception as e:
            print(f"⚠️ ALTER TABLE skipped: {e}")

        # Step 2 — look up token (try reset first, then invite) and check expiry
        is_invite = False
        with db.bind.connect() as conn:
            result = conn.execute(
                _text("SELECT id, password_reset_expires_at FROM users WHERE password_reset_token = :tok"),
                {"tok": reset_val}
            ).fetchone()
            if not result:
                result = conn.execute(
                    _text("SELECT id, password_reset_expires_at FROM users WHERE password_reset_token = :tok"),
                    {"tok": invite_val}
                ).fetchone()
                if result:
                    is_invite = True
        print(f"🔍 Token lookup result: found={result is not None} (invite={is_invite})")

        if not result:
            raise HTTPException(status_code=400, detail="Invalid or expired link. Please request a new one.")

        user_id = result[0]
        expires_at = result[1]

        # Check expiry
        if expires_at and datetime.utcnow() > expires_at:
            with db.bind.connect() as conn:
                conn.execute(_text("UPDATE users SET password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = :uid"), {"uid": user_id})
                conn.commit()
            detail = "This invite link has expired. Please ask your admin to resend it." if is_invite else "This reset link has expired. Please request a new password reset."
            raise HTTPException(status_code=400, detail=detail)

        # Step 3 — validate and hash
        validate_password_strength(new_password)
        hashed = get_password_hash(new_password[:72])

        # Step 4 — update password, clear token, unlock if locked
        with db.bind.connect() as conn:
            if is_invite:
                conn.execute(
                    _text("UPDATE users SET hashed_password = :pw, password_reset_token = NULL, password_reset_expires_at = NULL, is_active = TRUE, email_verified = TRUE WHERE id = :uid"),
                    {"pw": hashed, "uid": user_id}
                )
            else:
                # Also clear any lock — if someone is locked out and resets password, they should regain access
                conn.execute(
                    _text("UPDATE users SET hashed_password = :pw, password_reset_token = NULL, password_reset_expires_at = NULL, is_active = TRUE, locked_until = NULL, failed_login_attempts = 0 WHERE id = :uid"),
                    {"pw": hashed, "uid": user_id}
                )
            conn.commit()

        print("✅ Password set successful")
        message = "Account activated! You can now log in." if is_invite else "Password reset successfully. You can now log in."
        return {"ok": True, "message": message}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ reset_password error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")



@router.get("/signup/verify")
def verify_signup(token: str, db: Session = Depends(get_db)):
    """Verify a signup email token, activate the tenant + admin user, and return a login token."""
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    if not payload.get("signup_verify"):
        raise HTTPException(status_code=400, detail="Invalid verification token.")

    tenant = db.query(Tenant).filter(Tenant.id == payload.get("tenant_id")).first()
    user = db.query(User).filter(User.id == payload.get("user_id")).first()
    if not tenant or not user:
        raise HTTPException(status_code=404, detail="Account not found.")

    if not tenant.is_active or not user.is_active:
        tenant.is_active = True
        user.is_active = True
        db.commit()

    # Issue a normal login session token so the frontend can log them straight in
    session_id = str(uuid.uuid4())
    user.current_session_id = session_id
    db.commit()
    access_token = create_access_token({"sub": user.email, "sid": session_id})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "plan_selected": payload.get("plan", "free"),
        "tenant_slug": tenant.slug,
    }



@router.post("/auth/signup")
@limiter.limit("5/hour")
def signup(request: Request, data: dict, db: Session = Depends(get_db)):
    """Self-serve signup. Plan can be: essentials, business, pro, free.
    Tenant starts on selected plan as 14-day trial. Drops to free if no payment after trial.
    """
    company_name = (data.get("company_name") or "").strip()
    full_name    = (data.get("full_name") or "").strip()
    email        = (data.get("email") or "").strip().lower()
    password     = (data.get("password") or "").strip()
    plan         = (data.get("plan") or "essentials").strip().lower()

    valid_plans = ("free", "essentials", "business", "pro")
    if plan not in valid_plans:
        plan = "essentials"

    if not company_name or not full_name or not email or not password:
        raise HTTPException(status_code=400, detail="All fields are required.")

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.is_active:
            raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in or use a different email.")
        if existing_user.password_reset_token and existing_user.password_reset_token.startswith("invite_"):
            raise HTTPException(status_code=400, detail="This email address has already been invited to DodoDesk. Check your inbox for the invitation link.")
        old_tenant = db.query(Tenant).filter(Tenant.id == existing_user.tenant_id, Tenant.is_active == False).first()
        db.query(SignupVerification).filter(SignupVerification.user_id == existing_user.id).delete()
        db.delete(existing_user)
        if old_tenant:
            db.delete(old_tenant)
        db.commit()

    validate_password_strength(password)
    base_slug = slugify(company_name)
    slug = unique_slug(db, base_slug)

    try:
        super_tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        default_color  = super_tenant.primary_color if super_tenant and super_tenant.primary_color else "#4f46e5"
        default_accent = super_tenant.accent_color if super_tenant and super_tenant.accent_color else "#818cf8"

        # Create tenant on selected plan as 14-day trial
        tenant = Tenant(
            name=company_name, slug=slug,
            is_active=False,
            plan=plan,
            billing_status="trialing",
            primary_color=default_color,
            accent_color=default_accent,
        )
        db.add(tenant)
        db.flush()

        admin_user = User(
            tenant_id=tenant.id, email=email,
            hashed_password=get_password_hash(password),
            full_name=full_name, role=UserRole.ADMIN,
            is_active=False, email_verified=False,
        )
        db.add(admin_user)
        db.flush()

        token = generate_verification_token()
        verification = SignupVerification(
            token=token, email=email,
            tenant_id=tenant.id, user_id=admin_user.id,
            plan=plan, expires_at=datetime.utcnow() + timedelta(hours=24),
        )
        db.add(verification)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"❌ Signup DB error: {e}")
        raise HTTPException(status_code=500, detail=f"Account creation failed: {str(e)}")

    # Send verification email in background — capture plain values only, no DB objects
    frontend_url  = os.getenv("FRONTEND_URL", "https://dodo-desk-pied.vercel.app")
    verify_url    = f"{frontend_url}/verify-email?token={token}"
    _to           = str(email)
    _full_name    = str(full_name)
    _company_name = str(company_name)
    _verify_url   = str(verify_url)

    send_email_background(
        to=_to,
        subject="Verify your DodoDesk account",
        body=f"Hi {_full_name},\n\nWelcome to DodoDesk! Please verify your email address to activate your account for {_company_name}.\n\nThis link expires in 24 hours.",
        cta_url=_verify_url,
        cta_label="Verify Email",
    )

    return {
        "message": "Account created! Please check your email to verify your address before logging in.",
        "email": email,
    }



@router.get("/auth/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    """Verifies an email token and activates the tenant + admin user."""
    try:
        verification = db.query(SignupVerification).filter(
            SignupVerification.token == token,
            SignupVerification.used == False,
        ).first()

        if not verification:
            raise HTTPException(status_code=400, detail="Verification link is invalid or has already been used.")
        if verification.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Verification link has expired. Please sign up again.")

        tenant = db.query(Tenant).filter(Tenant.id == verification.tenant_id).first()
        user   = db.query(User).filter(User.id == verification.user_id).first()

        if not tenant or not user:
            raise HTTPException(status_code=400, detail="Account data not found. Please sign up again.")

        tenant.is_active   = True
        user.is_active     = True
        user.email_verified = True
        verification.used  = True

        session_id = str(uuid.uuid4())
        user.current_session_id = session_id
        db.commit()

        access_token = create_access_token({"sub": user.email, "sid": session_id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "plan_selected": verification.plan,
            "tenant_slug": tenant.slug,
            "message": "Email verified! Your account is now active.",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        db.rollback()
        print(f"❌ verify_email error: {e}")
        raise HTTPException(status_code=500, detail=f"Verification failed due to a server error. Please try again or contact support. ({type(e).__name__}: {str(e)[:200]})")



@router.post("/auth/resend-verification")
def resend_verification(data: dict, db: Session = Depends(get_db)):
    """Resends the verification email for a pending unverified signup."""
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")

    user = db.query(User).filter(User.email == email, User.email_verified == False).first()
    if not user:
        # Don't reveal if email exists or is already verified
        return {"message": "If this email has a pending verification, a new link has been sent."}

    # Invalidate old tokens
    db.query(SignupVerification).filter(
        SignupVerification.email == email,
        SignupVerification.used == False,
    ).update({"used": True})
    db.flush()

    # Issue new token
    token = generate_verification_token()
    verification = SignupVerification(
        token=token,
        email=email,
        tenant_id=user.tenant_id,
        user_id=user.id,
        plan=db.query(SignupVerification).filter(
            SignupVerification.user_id == user.id
        ).order_by(SignupVerification.id.desc()).first().plan if db.query(SignupVerification).filter(
            SignupVerification.user_id == user.id
        ).first() else "free",
        expires_at=datetime.utcnow() + timedelta(hours=24),
    )
    db.add(verification)
    db.commit()

    frontend_url   = os.getenv("FRONTEND_URL", "https://dodo-desk-pied.vercel.app")
    verify_url     = f"{frontend_url}/verify-email?token={token}"
    _to            = str(email)
    _full_name     = str(user.full_name)   # extract before session closes
    _verify_url    = str(verify_url)

    def _send_resend():
        print(f"📧 [thread] Resending verification email to {_to}, RESEND_API_KEY set={bool(RESEND_API_KEY)}")
        try:
            send_email(
                to=_to,
                subject="Verify your DodoDesk account (new link)",
                body=f"Hi {_full_name},\n\nHere's a new verification link for your DodoDesk account. The previous link has been invalidated.\n\nThis link expires in 24 hours.",
                cta_url=_verify_url,
                cta_label="Verify Email",
            )
        except Exception as e:
            print(f"⚠️ Failed to resend verification email: {e}")

    import threading
    threading.Thread(target=_send_resend, daemon=True).start()

    return {"message": "If this email has a pending verification, a new link has been sent."}



@router.post("/auth/login")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    # IP-based rate limiting
    client_ip = request.client.host if request.client else "unknown"
    if not check_ip_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please wait 1 minute before trying again.")

    user = db.query(User).filter(User.email == form_data.username).first()

    # Check if account is locked
    if user and user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=423, detail="Account locked due to too many failed attempts. Please contact your administrator.")

    if not user or not verify_password(form_data.password, user.hashed_password):
        if user:
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            # Use tenant-configured max attempts if set, else global default
            _tenant_max = 0
            if user.tenant_id:
                _t = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
                _tenant_max = getattr(_t, 'max_login_attempts', 0) or 0
            _effective_max = _tenant_max if _tenant_max > 0 else MAX_FAILED_ATTEMPTS
            if user.failed_login_attempts >= _effective_max:
                user.locked_until = datetime.utcnow() + timedelta(days=3650)
                user.failed_login_attempts = 0
                db.commit()
                raise HTTPException(status_code=423, detail=f"Account locked after {_effective_max} failed attempts. Please contact your administrator.")
            db.commit()
            remaining = _effective_max - user.failed_login_attempts
            raise HTTPException(status_code=401, detail=f"Invalid credentials. {remaining} attempt(s) remaining before account lockout.")
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    # Successful login — reset counters
    user.failed_login_attempts = 0
    user.locked_until = None
    if not user.is_active:
        db.commit()
        if not user.email_verified:
            raise HTTPException(status_code=403, detail="Please verify your email address before logging in. Check your inbox for the verification link.")
        raise HTTPException(status_code=403, detail="User account is disabled.")
    db.commit()

    # MFA check — if enabled, return a short-lived MFA challenge token instead of full access
    if user.mfa_enabled:
        mfa_token = create_access_token_with_expiry(
            data={"sub": user.email, "tenant_id": user.tenant_id, "mfa_pending": True},
            minutes=5
        )
        return {"mfa_required": True, "mfa_token": mfa_token}

    # If tenant requires MFA but this user hasn't set it up yet, allow login but flag it
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    mfa_setup_required = bool(tenant and tenant.mfa_required and not user.mfa_enabled)

    # Single-session enforcement — generate new session ID, invalidating any previous session
    import uuid as _uuid
    session_id = str(_uuid.uuid4())
    user.current_session_id = session_id
    log_system_event(db, user, "user.login",
                     target_type="user", target_id=user.id, target_label=user.email,
                     ip_address=request.client.host if request.client else None)
    db.commit()

    # Use tenant's configured session timeout if set, else default
    _session_mins = None
    if user.tenant_id:
        _tenant_for_session = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        _timeout = getattr(_tenant_for_session, 'session_timeout_minutes', None)
        if _timeout and int(_timeout) > 0:
            _session_mins = int(_timeout)
    if _session_mins:
        access_token = create_access_token_with_expiry(
            data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id},
            minutes=_session_mins
        )
    else:
        access_token = create_access_token(data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id})
    return {"access_token": access_token, "token_type": "bearer", "mfa_setup_required": mfa_setup_required}


@router.post("/auth/login/mfa")
def login_mfa_verify(data: dict, db: Session = Depends(get_db)):
    """Step 2 of login when MFA is enabled. Accepts the mfa_token from /auth/login plus a 6-digit code or backup code."""
    mfa_token = data.get("mfa_token", "")
    code = data.get("code", "")
    try:
        payload = decode_access_token(mfa_token)
        if not payload.get("mfa_pending"):
            raise HTTPException(status_code=401, detail="Invalid MFA session.")
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="MFA session expired. Please log in again.")

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.mfa_enabled:
        raise HTTPException(status_code=401, detail="Invalid MFA session.")

    # Try TOTP code first
    valid = verify_totp(user.mfa_secret, code)

    # Fall back to backup codes
    if not valid:
        backup_codes = json.loads(user.mfa_backup_codes or "[]")
        normalized = code.strip().upper()
        if normalized in backup_codes:
            valid = True
            backup_codes.remove(normalized)
            user.mfa_backup_codes = json.dumps(backup_codes)

    if not valid:
        raise HTTPException(status_code=401, detail="Invalid authentication code.")

    # Single-session enforcement
    import uuid as _uuid
    session_id = str(_uuid.uuid4())
    user.current_session_id = session_id
    db.commit()

    # Use tenant's configured session timeout if set, else default
    _session_mins = None
    if user.tenant_id:
        _tenant_for_session = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        _timeout = getattr(_tenant_for_session, 'session_timeout_minutes', None)
        if _timeout and int(_timeout) > 0:
            _session_mins = int(_timeout)
    if _session_mins:
        access_token = create_access_token_with_expiry(
            data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id},
            minutes=_session_mins
        )
    else:
        access_token = create_access_token(data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id})
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/auth/confirm-email-change")
def confirm_email_change(token: str, db: Session = Depends(get_db)):
    """Step 2: user clicks the link in their new email inbox.
    Updates users.email to the new address and clears pending state.
    """
    user = db.query(User).filter(User.email_change_token == token).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired confirmation link.")
    if not user.email_change_expires_at or datetime.utcnow() > user.email_change_expires_at:
        user.pending_email = None
        user.email_change_token = None
        user.email_change_expires_at = None
        db.commit()
        raise HTTPException(status_code=400, detail="This confirmation link has expired. Please request a new email change from Settings.")

    new_email = user.pending_email
    # Double-check the new email isn't taken (race condition guard)
    taken = db.query(User).filter(User.email == new_email, User.id != user.id).first()
    if taken:
        user.pending_email = None
        user.email_change_token = None
        user.email_change_expires_at = None
        db.commit()
        raise HTTPException(status_code=400, detail="That email address has been taken by another account. Please choose a different email.")

    old_email = user.email
    user.email = new_email
    user.pending_email = None
    user.email_change_token = None
    user.email_change_expires_at = None
    db.commit()

    log_system_event(db, user, "user.email_changed",
                     target_type="user", target_id=user.id, target_label=new_email,
                     old_value=old_email, new_value=new_email)
    db.commit()

    # Redirect to login — their session token still has the old email so they must log in again
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"{FRONTEND_URL}/login?email_changed=1")
