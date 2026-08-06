"""
Asset management — hardware, software, SaaS, attachments router.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text
from datetime import datetime, timedelta, date
from typing import Optional
import json, uuid, os, re, io, csv, threading

# Import everything from shared utilities (avoids circular import with main.py)
from shared import (
    get_db, SessionLocal,
    get_current_user, get_current_admin_user, has_permission, Permission,
    oauth2_scheme, OAuth2PasswordRequestForm,
    User, Tenant, Ticket, Comment, Notification, KBArticle, Asset,
    ChangeRequest, SystemAuditLog, TicketAuditLog, Macro, AutomationRule,
    EscalationRule, Group, CustomField, TicketTemplate, ApprovalWorkflow,
    ServiceCatalogItem, CannedResponse, TicketView, TicketTask, Attachment,
    TicketCreate, TicketUpdate, TicketOut, CommentCreate, CommentOut,
    KBArticleCreate, KBArticleUpdate, KBArticleOut,
    AssetCreate, AssetUpdate, AssetOut, LinkAssetRequest,
    UserOut, UserCreate, UserInvite, UserUpdate, UserProfileUpdate, PasswordUpdate,
    CannedResponseCreate, CannedResponseUpdate, CannedResponseOut,
    ChangeCreate, ChangeUpdate, ChangeOut,
    ServiceCatalogItemCreate, ServiceCatalogItemOut,
    BulkTicketAction, InboundEmail, CSATSubmit, CSATStats, AttachmentOut,
    SignupRequest, TenantOut, CustomRoleCreate, CustomRoleOut,
    get_email_config, send_email, send_email_background, send_notification,
    create_notification, build_html_email, translate_email,
    log_ticket_event, _ticket_tenant_filter, compute_sla_deadlines,
    pause_sla, resume_sla, get_sla_rules, compute_sla_status,
    run_automation_rules, trigger_approval_workflow,
    get_plan_limits, get_user_language, check_tenant_limit, check_user_limit,
    plan_requires, get_trial_status, validate_password_strength,
    get_password_hash, verify_password, create_access_token,
    create_access_token_with_expiry, decode_access_token,
    check_ip_rate_limit, log_system_event,
    generate_totp_secret, totp_provisioning_uri, verify_totp, generate_backup_codes,
    upload_to_cloudinary, get_signed_url,
    get_business_hours_config, add_business_hours,
    _sql_safe_search, _cr_to_out, _safe_json,
    _asset_to_out, _ticket_to_out, _catalog_to_out, _change_to_out,
    _notify_watchers, _round_robin_assign, _user_wants_notif,
    _get_oauth_redirect_uri, _build_anthropic_history, _build_system_prompt,
    _check_enterprise, _execute_tool, _get_or_create_session,
    _run_agentic_loop, _send_scheduled_report,
    limiter, Limiter, get_remote_address,
    API_URL, FRONTEND_URL, SECRET_KEY, ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES, MAX_FAILED_ATTEMPTS,
    PLAN_LIMITS, SLA_RULES,
)

router = APIRouter()


@router.get("/assets/")
def list_assets(search: str | None = Query(None), skip: int = Query(0, ge=0),
                limit: int = Query(20, ge=1, le=200),
                asset_type: str | None = Query(None),
                status: str | None = Query(None),
                location: str | None = Query(None),
                expiring_soon: bool = Query(False),
                days: int = Query(90),
                db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    try:
        query = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id)
        if expiring_soon:
            cutoff = datetime.utcnow().date() + timedelta(days=days)
            today = datetime.utcnow().date()
            query = query.filter(
                ((Asset.expiry_date != None) & (Asset.expiry_date >= today) & (Asset.expiry_date <= cutoff)) |
                ((Asset.warranty_expiry != None) & (Asset.warranty_expiry >= today) & (Asset.warranty_expiry <= cutoff))
            )
        if search:
            term = f"%{search}%"
            query = query.filter(
                Asset.name.ilike(term) | Asset.serial_number.ilike(term) |
                Asset.vendor.ilike(term) | Asset.tag_number.ilike(term) |
                Asset.location.ilike(term)
            )
        if asset_type:
            # Use text comparison to avoid enum case mismatch
            from sqlalchemy import text as _t, cast, String
            query = query.filter(cast(Asset.type, String).ilike(asset_type))
        if status:
            from sqlalchemy import cast, String
            query = query.filter(cast(Asset.status, String).ilike(status))
        if location:
            query = query.filter(Asset.location.ilike(f"%{_sql_safe_search(location)}%"))
        total = query.count()
        assets = query.order_by(Asset.name).offset(skip).limit(limit).all()
        items = []
        for a in assets:
            try:
                items.append(_asset_to_out(a, db))
            except Exception as e:
                print(f"⚠️ _asset_to_out error for asset {a.id}: {e}")
                # Return minimal safe dict
                items.append({"id": a.id, "name": a.name or "Unknown",
                               "type": str(a.type) if a.type else None,
                               "status": str(a.status) if a.status else None})
        return {"items": items, "total": total, "skip": skip, "limit": limit}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Assets fetch error: {str(e)[:300]}")


@router.get("/assets/expiring")
def expiring_assets(days: int = Query(30), db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Returns assets whose license OR warranty expires within the given window."""
    try:
        today = date.today()
        deadline = today + timedelta(days=days)
        from sqlalchemy import or_, and_
        assets = db.query(Asset).filter(
            Asset.tenant_id == current_user.tenant_id,
            or_(
                and_(Asset.expiry_date.isnot(None), Asset.expiry_date > today, Asset.expiry_date <= deadline),
                and_(Asset.warranty_expiry.isnot(None), Asset.warranty_expiry > today, Asset.warranty_expiry <= deadline),
            )
        ).order_by(sa_func.coalesce(Asset.expiry_date, Asset.warranty_expiry)).all()
        return [_asset_to_out(a, db) for a in assets]
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Expiring assets error: {str(e)[:300]}")


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return _asset_to_out(asset, db)


@router.get("/asset-model-options/")
def list_asset_model_options(asset_type: str | None = Query(None),
                              db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    """Returns admin-managed model/manufacturer options, optionally filtered to one asset type."""
    from sqlalchemy import text as _t
    try:
        if asset_type:
            rows = db.execute(_t(
                "SELECT id, asset_type::text, label, sort_order FROM asset_model_options "
                "WHERE tenant_id = :tid AND lower(asset_type::text) = :atype "
                "ORDER BY sort_order, label"
            ), {"tid": current_user.tenant_id, "atype": asset_type.lower()}).fetchall()
        else:
            rows = db.execute(_t(
                "SELECT id, asset_type::text, label, sort_order FROM asset_model_options "
                "WHERE tenant_id = :tid ORDER BY asset_type, sort_order, label"
            ), {"tid": current_user.tenant_id}).fetchall()
        return [{"id": r[0], "asset_type": r[1].lower() if r[1] else r[1],
                 "label": r[2], "sort_order": r[3]} for r in rows]
    except Exception as e:
        print(f"⚠️ list_asset_model_options error: {e}")
        return []


@router.post("/asset-model-options/")
def create_asset_model_option(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        if str(current_user.role) not in ("agent", "admin", "super_admin", "platform_admin"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        label = (data.get("label") or "").strip()
        if not label:
            raise HTTPException(status_code=422, detail="Label is required")
        asset_type_str = (data.get("asset_type") or "").lower().strip()
        valid_types = [e.value for e in AssetType]
        if asset_type_str not in valid_types:
            raise HTTPException(status_code=422, detail=f"Invalid asset_type '{asset_type_str}'.")
        sort_order = int(data.get("sort_order") or 0)
        from sqlalchemy import text as _t
        result = db.execute(_t(
            "INSERT INTO asset_model_options (tenant_id, asset_type, label, sort_order) "
            "VALUES (:tid, :atype, :label, :sort) RETURNING id"
        ), {"tid": current_user.tenant_id, "atype": asset_type_str, "label": label, "sort": sort_order})
        row = result.fetchone()
        db.commit()
        return {"id": row[0], "asset_type": asset_type_str, "label": label, "sort_order": sort_order}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not create model option: {str(e)[:200]}")


@router.delete("/asset-model-options/{option_id}")
def delete_asset_model_option(option_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_SETTINGS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    option = db.query(AssetModelOption).filter(
        AssetModelOption.id == option_id, AssetModelOption.tenant_id == current_user.tenant_id
    ).first()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")
    db.delete(option)
    db.commit()
    return {"ok": True}


@router.get("/assets/{asset_id}/history")
def get_asset_history(asset_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    history = db.query(AssetHistory).filter(AssetHistory.asset_id == asset_id).order_by(AssetHistory.changed_at.desc()).all()
    return [{
        "id": h.id,
        "action": h.action,
        "from_user": h.from_user.full_name if h.from_user else None,
        "to_user": h.to_user.full_name if h.to_user else None,
        "note": h.note,
        "changed_by": h.changed_by.full_name if h.changed_by else None,
        "changed_at": h.changed_at,
    } for h in history]


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    from sqlalchemy import text as _t
    row = db.execute(_t(
        "SELECT id FROM assets WHERE id=:id AND tenant_id=:tid"
    ), {"id": asset_id, "tid": current_user.tenant_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")
    try:
        # Get asset name for audit log before deleting
        asset_row = db.execute(_t(
            "SELECT name, type FROM assets WHERE id=:id"
        ), {"id": asset_id}).fetchone()
        asset_name = asset_row[0] if asset_row else f"Asset #{asset_id}"
        asset_type = asset_row[1] if asset_row else "unknown"

        # Delete related records first to avoid FK violations
        db.execute(_t("DELETE FROM asset_history WHERE asset_id=:id"), {"id": asset_id})
        db.execute(_t("UPDATE tickets SET asset_id=NULL WHERE asset_id=:id"), {"id": asset_id})
        db.execute(_t("DELETE FROM assets WHERE id=:id AND tenant_id=:tid"),
                   {"id": asset_id, "tid": current_user.tenant_id})

        # Audit log
        log_system_event(db, current_user, "asset.deleted",
                         target_type="asset", target_id=asset_id,
                         target_label=f"{asset_name} ({asset_type})")
        db.commit()
        return {"detail": "Asset deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)[:200]}")


@router.get("/assets/insights/summary")
def asset_insights(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Asset insights dashboard — counts by type, status, expiry alerts."""
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    assets = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id).all()
    today = date.today()
    by_type = {}
    by_status = {}
    expiring_30 = 0
    expiring_90 = 0
    warranty_expiring = 0
    maintenance_due = 0
    total_cost = 0.0
    for a in assets:
        t = str(a.type) if a.type else "other"
        s = str(a.status) if a.status else "unknown"
        by_type[t] = by_type.get(t, 0) + 1
        by_status[s] = by_status.get(s, 0) + 1
        if a.expiry_date:
            days = (a.expiry_date - today).days
            if days <= 30: expiring_30 += 1
            elif days <= 90: expiring_90 += 1
        if a.warranty_expiry and (a.warranty_expiry - today).days <= 30:
            warranty_expiring += 1
        if a.maintenance_date and a.maintenance_date.date() <= today:
            maintenance_due += 1
        if a.purchase_cost:
            total_cost += a.purchase_cost
    return {
        "total": len(assets),
        "by_type": by_type,
        "by_status": by_status,
        "expiring_30_days": expiring_30,
        "expiring_90_days": expiring_90,
        "warranty_expiring_30_days": warranty_expiring,
        "maintenance_due": maintenance_due,
        "total_purchase_cost": round(total_cost, 2),
    }


@router.post("/assets/bulk-import")
def bulk_import_assets(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bulk import assets from CSV rows. data = {rows: [{name, type, serial_number, ...}]}"""
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    rows = data.get("rows", [])
    created = 0
    errors = []
    for i, row in enumerate(rows):
        try:
            name = row.get("name", "").strip()
            if not name:
                errors.append(f"Row {i+1}: name is required")
                continue
            raw_type = row.get("type", "hardware").lower().strip()
            try:
                asset_type = raw_type
            except ValueError:
                asset_type = "hardware"
            db_asset = Asset(
                tenant_id=current_user.tenant_id,
                name=name, type=asset_type,
                serial_number=row.get("serial_number") or None,
                vendor=row.get("vendor") or None,
                location=row.get("location") or None,
                notes=row.get("notes") or None,
                tag_number=row.get("tag_number") or None,
                purchase_cost=float(row["purchase_cost"]) if row.get("purchase_cost") else None,
                status=str(row.get("status", "available")).lower(),
            )
            db.add(db_asset)
            created += 1
        except Exception as e:
            errors.append(f"Row {i+1}: {str(e)}")
    db.commit()
    return {"created": created, "errors": errors}


@router.post("/assets/bulk-action")
def bulk_asset_action(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bulk action on multiple assets. data = {asset_ids: [], action: 'retire'|'assign'|'maintenance', value: ...}"""
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    asset_ids = data.get("asset_ids", [])
    action = data.get("action")
    value = data.get("value")
    updated = 0
    for asset_id in asset_ids:
        asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
        if not asset:
            continue
        if action == "retire":
            asset.status = "retired"
        elif action == "maintenance":
            asset.status = "maintenance"
        elif action == "available":
            asset.status = "available"
            asset.assigned_to_id = None
        elif action == "assign" and value:
            asset.assigned_to_id = int(value)
            asset.status = "assigned"
            db.add(AssetHistory(asset_id=asset_id, action="assigned",
                                to_user_id=int(value), changed_by_id=current_user.id))
        updated += 1
    db.commit()
    return {"updated": updated}



@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    # Tenant safety check — prevent cross-tenant access
    ticket = db.query(Ticket).filter(Ticket.id == attachment.ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=403, detail="Access denied")
    # If stored as Cloudinary public_id (authenticated type), generate signed URL
    if attachment.url and not attachment.url.startswith("http"):
        # It's a public_id stored after auth migration
        ext = os.path.splitext(attachment.filename)[1].lower()
        rtype = "image" if ext in {".png",".jpg",".jpeg",".gif",".webp",".svg"} else "raw"
        signed = get_signed_url(attachment.url, resource_type=rtype)
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=signed)
    # Legacy: stored URL (public or old Cloudinary URL)
    if attachment.url:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=attachment.url)
    # Legacy local file fallback
    file_path = os.path.join(UPLOAD_DIR, attachment.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found — it may have been lost during a server redeploy. Please re-upload.")
    return FileResponse(file_path, media_type=attachment.content_type or "application/octet-stream",
                        filename=attachment.filename)

