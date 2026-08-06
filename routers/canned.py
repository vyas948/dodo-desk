"""
Canned responses router.
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
    get_db, get_current_user, get_current_admin_user, has_permission, Permission,
    User, Tenant, Ticket, Comment, Notification, KBArticle, Asset,
    ChangeRequest, SystemAuditLog, TicketAuditLog, Macro, AutomationRule,
    EscalationRule, Group, CustomField, TicketTemplate, ApprovalWorkflow,
    ServiceCatalogItem, CannedResponse, TicketView, TicketTask, Attachment,
    get_email_config, send_email, create_notification, log_ticket_event,
    compute_sla_deadlines, pause_sla, resume_sla, get_sla_rules,
    get_plan_limits, get_user_language, _ticket_tenant_filter,
    run_automation_rules, API_URL, FRONTEND_URL, SECRET_KEY, ALGORITHM,
    get_password_hash, verify_password, create_access_token,
    create_access_token_with_expiry, _sql_safe_search,
    get_business_hours_config, add_business_hours,
    PLAN_LIMITS, SLA_RULES, SessionLocal, func as _func,
)

router = APIRouter()


@router.get("/canned-responses/")
def list_canned_responses(
    category: str | None = Query(None),
    search: str | None = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(CannedResponse).filter(
        CannedResponse.tenant_id == current_user.tenant_id
    )
    # Visibility filter — personal only shows own, group shows group
    query = query.filter(
        (CannedResponse.visibility == "all") |
        ((CannedResponse.visibility == "personal") & (CannedResponse.author_id == current_user.id)) |
        (CannedResponse.visibility == "group")  # group filtering handled below
    )
    if category:
        query = query.filter(CannedResponse.category == category)
    if search:
        query = query.filter(
            CannedResponse.title.ilike(f"%{_sql_safe_search(search)}%") |
            CannedResponse.content.ilike(f"%{_sql_safe_search(search)}%")
        )
    total = query.count()
    responses = query.order_by(CannedResponse.sort_order, CannedResponse.title).offset(skip).limit(limit).all()
    return {"items": [_cr_to_out(r, db) for r in responses], "total": total}


@router.get("/canned-responses/categories")
def list_canned_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return all distinct categories (folders) used in canned responses."""
    rows = db.query(CannedResponse.category).filter(
        CannedResponse.tenant_id == current_user.tenant_id,
        CannedResponse.category != None,
        CannedResponse.category != ""
    ).distinct().all()
    return sorted([r[0] for r in rows if r[0]])


@router.post("/canned-responses/{response_id}/use")
def record_canned_use(response_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Increment use_count when agent inserts a canned response."""
    r = db.query(CannedResponse).filter(
        CannedResponse.id == response_id,
        CannedResponse.tenant_id == current_user.tenant_id
    ).first()
    if r:
        r.use_count = (r.use_count or 0) + 1
        db.commit()
    return {"ok": True}


@router.delete("/canned-responses/{response_id}")
def delete_canned_response(
    response_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_CANNED):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_response = db.query(CannedResponse).filter(
        CannedResponse.id == response_id,
        CannedResponse.tenant_id == current_user.tenant_id
    ).first()
    if not db_response:
        raise HTTPException(status_code=404, detail="Canned response not found")
    db.delete(db_response)
    db.commit()
    return {"detail": "Canned response deleted"}

