"""
Knowledge base — articles, search, categories router.
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


@router.get("/kb/articles/")
def search_kb_articles(search: str | None = Query(None), skip: int = Query(0, ge=0),
                       limit: int = Query(20, ge=1, le=200), status: str | None = Query(None),
                       category: str | None = Query(None), folder: str | None = Query(None),
                       tag: str | None = Query(None), needs_review: bool = Query(False),
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(KBArticle).filter(KBArticle.tenant_id == current_user.tenant_id)
    # Employees only see published + visible articles
    if not has_permission(current_user, Permission.MANAGE_KB):
        query = query.filter(KBArticle.status == "published")
        query = query.filter(KBArticle.visibility.in_(["all", "employees_only"]))
    else:
        if status:
            query = query.filter(KBArticle.status == status)
        # agents_only articles visible to agents/admins
        query = query.filter(KBArticle.visibility.in_(["all", "agents_only"]))
    if search:
        term = f"%{search}%"
        query = query.filter(KBArticle.title.ilike(term) | KBArticle.content.ilike(term) | KBArticle.tags.ilike(term))
    if category:
        query = query.filter(KBArticle.category == category)
    if folder:
        query = query.filter(KBArticle.folder == folder)
    if tag:
        query = query.filter(KBArticle.tags.ilike(f'%"{_sql_safe_search(tag)}"%'))
    if needs_review:
        query = query.filter(KBArticle.review_date.isnot(None), KBArticle.review_date < datetime.utcnow())
    total = query.count()
    articles = query.order_by(KBArticle.sort_order, KBArticle.updated_at.desc()).offset(skip).limit(limit).all()
    result = []
    for art in articles:
        author = db.query(User).filter(User.id == art.author_id).first()
        result.append({
            "id": art.id, "title": art.title, "content": art.content,
            "category": art.category, "folder": art.folder,
            "author_id": art.author_id, "author_name": author.full_name if author else "Unknown",
            "status": art.status or "published", "version": art.version or 1,
            "view_count": art.view_count or 0,
            "helpful_count": art.helpful_count or 0,
            "not_helpful_count": art.not_helpful_count or 0,
            "tags": json.loads(art.tags) if art.tags else [],
            "visibility": art.visibility or "all",
            "review_date": art.review_date,
            "sort_order": art.sort_order or 0,
            "created_at": art.created_at, "updated_at": art.updated_at,
        })
    return {"items": result, "total": total, "skip": skip, "limit": limit}


@router.get("/kb/articles/{article_id}/versions")
def get_kb_versions(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Full version history. Agents/admins only."""
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    versions = db.query(KBVersion).filter(KBVersion.article_id == article_id).order_by(KBVersion.version_number.desc()).all()
    return [{"id": v.id, "version_number": v.version_number, "title": v.title,
             "content": v.content, "category": v.category, "status": v.status,
             "change_note": v.change_note,
             "edited_by": v.edited_by.full_name if v.edited_by else "Unknown",
             "created_at": v.created_at} for v in versions]


@router.post("/kb/articles/{article_id}/restore/{version_id}")
def restore_kb_version(article_id: int, version_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Restore a previous version as current content."""
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    version = db.query(KBVersion).filter(KBVersion.id == version_id, KBVersion.article_id == article_id).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    new_ver_num = (article.version or 1) + 1
    db.add(KBVersion(article_id=article_id, version_number=new_ver_num,
                     title=article.title, content=article.content, category=article.category,
                     status=article.status, change_note=f"Restored from v{version.version_number}",
                     edited_by_id=current_user.id))
    article.title = version.title
    article.content = version.content
    article.category = version.category
    article.version = new_ver_num
    article.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "restored_from_version": version.version_number, "new_version": new_ver_num}


@router.get("/kb/articles/{article_id}")
def get_kb_article(article_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    # Only count views for employees (not agents editing)
    if not has_permission(current_user, Permission.MANAGE_KB):
        article.view_count = (article.view_count or 0) + 1
        db.commit()
    author = db.query(User).filter(User.id == article.author_id).first()
    return {"id": article.id, "title": article.title, "content": article.content,
            "category": article.category, "folder": article.folder,
            "author_id": article.author_id, "author_name": author.full_name if author else "Unknown",
            "status": article.status or "published", "version": article.version or 1,
            "view_count": article.view_count or 0,
            "helpful_count": article.helpful_count or 0,
            "not_helpful_count": article.not_helpful_count or 0,
            "tags": json.loads(article.tags) if article.tags else [],
            "visibility": article.visibility or "all",
            "review_date": article.review_date,
            "sort_order": article.sort_order or 0,
            "custom_fields_data": json.loads(article.custom_fields_data) if article.custom_fields_data else {},
            "created_at": article.created_at, "updated_at": article.updated_at}


@router.post("/kb/articles/")
def create_kb_article(article: KBArticleCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = KBArticle(
        tenant_id=current_user.tenant_id,
        title=article.title, content=article.content, category=article.category,
        folder=article.folder, author_id=current_user.id, status=article.status, version=1,
        tags=json.dumps(article.tags) if article.tags else None,
        visibility=article.visibility or "all",
        review_date=article.review_date,
        custom_fields_data=json.dumps(article.custom_fields_data) if article.custom_fields_data else None,
    )
    db.add(db_article)
    db.flush()
    db.add(KBVersion(article_id=db_article.id, version_number=1, title=article.title,
                     content=article.content, category=article.category, status=article.status,
                     change_note="Initial version", edited_by_id=current_user.id))
    db.commit()
    db.refresh(db_article)
    return {"id": db_article.id, "title": db_article.title, "content": db_article.content,
            "category": db_article.category, "folder": db_article.folder,
            "author_id": db_article.author_id, "author_name": current_user.full_name,
            "status": db_article.status, "version": db_article.version,
            "view_count": db_article.view_count or 0,
            "helpful_count": 0, "not_helpful_count": 0,
            "tags": article.tags or [], "visibility": db_article.visibility or "all",
            "review_date": db_article.review_date, "sort_order": 0,
            "custom_fields_data": article.custom_fields_data or {},
            "created_at": db_article.created_at, "updated_at": db_article.updated_at}


@router.put("/kb/articles/{article_id}")
async def update_kb_article(article_id: int, request: Request,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    raw_body = await request.json()
    # Convert empty strings to None so Pydantic accepts optional fields
    cleaned = {k: (None if v == "" else v) for k, v in raw_body.items()}
    article = KBArticleUpdate(**cleaned)
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")
    if article.category is not None and not article.category.strip():
        raise HTTPException(status_code=422, detail="Category is required")
    update_data = article.model_dump(exclude_unset=True)
    change_note = update_data.pop("change_note", None)
    new_version = (db_article.version or 1) + 1
    db.add(KBVersion(
        article_id=article_id, version_number=new_version,
        title=update_data.get("title", db_article.title),
        content=update_data.get("content", db_article.content),
        category=update_data.get("category", db_article.category),
        status=update_data.get("status", db_article.status),
        change_note=change_note, edited_by_id=current_user.id
    ))
    for field in ["title", "content", "category", "folder", "status", "visibility", "review_date", "sort_order"]:
        if field in update_data:
            setattr(db_article, field, update_data[field])
    if "tags" in update_data:
        db_article.tags = json.dumps(update_data["tags"]) if update_data["tags"] else None
    if "custom_fields_data" in update_data:
        db_article.custom_fields_data = json.dumps(update_data["custom_fields_data"]) if update_data["custom_fields_data"] else None
    db_article.version = new_version
    db_article.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_article)
    author = db.query(User).filter(User.id == db_article.author_id).first()
    return {"id": db_article.id, "title": db_article.title, "content": db_article.content,
            "category": db_article.category, "folder": db_article.folder,
            "author_id": db_article.author_id, "author_name": author.full_name if author else "Unknown",
            "status": db_article.status, "version": db_article.version,
            "view_count": db_article.view_count or 0,
            "helpful_count": db_article.helpful_count or 0,
            "not_helpful_count": db_article.not_helpful_count or 0,
            "tags": json.loads(db_article.tags) if db_article.tags else [],
            "visibility": db_article.visibility or "all",
            "review_date": db_article.review_date, "sort_order": db_article.sort_order or 0,
            "custom_fields_data": json.loads(db_article.custom_fields_data) if db_article.custom_fields_data else {},
            "created_at": db_article.created_at, "updated_at": db_article.updated_at}


@router.delete("/kb/articles/{article_id}")
def delete_kb_article(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")
    db.delete(db_article)
    db.commit()
    return {"detail": "Article deleted"}


@router.post("/kb/articles/{article_id}/feedback")
def submit_kb_feedback(article_id: int, data: dict,
                       current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    """Submit 👍/👎 feedback on a KB article."""
    article = db.query(KBArticle).filter(
        KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id
    ).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    helpful = data.get("helpful")  # True = 👍, False = 👎
    if helpful is True:
        article.helpful_count = (article.helpful_count or 0) + 1
    elif helpful is False:
        article.not_helpful_count = (article.not_helpful_count or 0) + 1
    db.commit()
    return {"helpful_count": article.helpful_count, "not_helpful_count": article.not_helpful_count}


@router.get("/kb/categories")
def get_kb_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all distinct categories and folders for KB navigation."""
    query = db.query(KBArticle.category, KBArticle.folder).filter(
        KBArticle.tenant_id == current_user.tenant_id,
        KBArticle.status == "published"
    )
    if not has_permission(current_user, Permission.MANAGE_KB):
        query = query.filter(KBArticle.visibility.in_(["all", "employees_only"]))
    rows = query.distinct().all()
    structure = {}
    for cat, folder in rows:
        cat = cat or "General"
        if cat not in structure:
            structure[cat] = []
        if folder and folder not in structure[cat]:
            structure[cat].append(folder)
    return [{"category": cat, "folders": folders} for cat, folders in sorted(structure.items())]


@router.get("/kb/articles/{article_id}/related")
def get_related_articles(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get related articles based on same category/tags."""
    article = db.query(KBArticle).filter(
        KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id
    ).first()
    if not article:
        return []
    query = db.query(KBArticle).filter(
        KBArticle.tenant_id == current_user.tenant_id,
        KBArticle.id != article_id,
        KBArticle.status == "published",
        KBArticle.category == article.category
    ).limit(5)
    related = query.all()
    return [{"id": a.id, "title": a.title, "category": a.category,
             "view_count": a.view_count or 0} for a in related]


@router.get("/kb/insights")
def get_kb_insights(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """KB insights for agents/admins — most viewed, least helpful, needs review."""
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    articles = db.query(KBArticle).filter(
        KBArticle.tenant_id == current_user.tenant_id,
        KBArticle.status == "published"
    ).all()
    most_viewed = sorted(articles, key=lambda a: a.view_count or 0, reverse=True)[:5]
    least_helpful = [a for a in articles if (a.not_helpful_count or 0) > 0]
    least_helpful = sorted(least_helpful, key=lambda a: (a.not_helpful_count or 0), reverse=True)[:5]
    needs_review_all = [a for a in articles if a.review_date and a.review_date < datetime.utcnow()]
    needs_review = needs_review_all[:5]
    def fmt(a):
        return {"id": a.id, "title": a.title, "category": a.category,
                "view_count": a.view_count or 0,
                "helpful_count": a.helpful_count or 0,
                "not_helpful_count": a.not_helpful_count or 0,
                "review_date": a.review_date}
    return {
        "most_viewed": [fmt(a) for a in most_viewed],
        "least_helpful": [fmt(a) for a in least_helpful],
        "needs_review": [fmt(a) for a in needs_review],
        "needs_review_count": len(needs_review_all),
        "total_articles": len(articles),
        "total_views": sum(a.view_count or 0 for a in articles),
    }

# ---------- Asset Management (tenant‑scoped + permissions) ----------
def _asset_to_out(a, db):
    assigned = db.query(User).filter(User.id == a.assigned_to_id).first() if a.assigned_to_id else None
    ticket_count = db.query(Ticket).filter(Ticket.asset_id == a.id).count()
    try:
        asset_type = str(a.type) if hasattr(a.type, 'value') else str(a.type).lower() if a.type else None
    except Exception:
        asset_type = str(a.type) if a.type else None
    try:
        asset_status = str(a.status) if hasattr(a.status, 'value') else str(a.status) if a.status else None
    except Exception:
        asset_status = str(a.status) if a.status else None
    return {
        "id": a.id, "name": a.name, "type": asset_type, "model": a.model, "serial_number": a.serial_number,
        "status": asset_status, "assigned_to_id": a.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": str(a.purchase_date) if a.purchase_date else None,
        "license_key": a.license_key,
        "vendor": a.vendor,
        "expiry_date": str(a.expiry_date) if a.expiry_date else None,
        "notes": a.notes,
        "location": a.location, "purchase_cost": float(a.purchase_cost) if a.purchase_cost else None,
        "warranty_expiry": str(a.warranty_expiry) if a.warranty_expiry else None,
        "contract_number": a.contract_number,
        "quantity": a.quantity or 1, "seats_total": a.seats_total,
        "seats_used": a.seats_used or 0,
        "maintenance_date": str(a.maintenance_date) if a.maintenance_date else None,
        "parent_asset_id": a.parent_asset_id, "tag_number": a.tag_number,
        "custom_fields_data": json.loads(a.custom_fields_data) if a.custom_fields_data else {},
        "ticket_count": ticket_count,
        "created_at": str(a.created_at) if a.created_at else None,
        "updated_at": str(a.updated_at) if a.updated_at else None,
    }
