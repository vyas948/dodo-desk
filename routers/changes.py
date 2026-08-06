"""
Change management — requests, approvals, tasks, calendar router.
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


@router.post("/changes/")
def create_change(change: ChangeCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    plan_requires("change_management", tenant, "Change Management is available on the Pro plan and above. Please upgrade.")
    db_change = ChangeRequest(
        tenant_id=current_user.tenant_id,
        title=change.title,
        description=change.description,
        change_type=change.change_type or "normal",
        risk_level=change.risk_level,
        risk_score=change.risk_score,
        planned_date=change.planned_date,
        start_date=change.start_date,
        end_date=change.end_date,
        impact=change.impact,
        rollback_plan=change.rollback_plan,
        test_plan=change.test_plan,
        owner_id=change.owner_id,
        assigned_to_id=change.assigned_to_id,
        cab_members=json.dumps(change.cab_members) if change.cab_members else None,
        linked_ticket_ids=json.dumps(change.linked_ticket_ids) if change.linked_ticket_ids else None,
        linked_asset_ids=json.dumps(change.linked_asset_ids) if change.linked_asset_ids else None,
        requester_id=current_user.id,
        status="draft"
    )
    db.add(db_change)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create change: {str(e)}")
    db.refresh(db_change)
    return _change_to_out(db_change, db=db)


@router.get("/changes/")
def list_changes(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200),
                 search: str = Query("", alias="search"),
                 status: str | None = Query(None),
                 change_type: str | None = Query(None),
                 risk_level: str | None = Query(None),
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    query = db.query(ChangeRequest).filter(ChangeRequest.tenant_id == current_user.tenant_id)
    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        query = query.filter(ChangeRequest.requester_id == current_user.id)
    if search:
        from sqlalchemy import or_
        import re as _re
        search_term = f"%{search}%"
        id_match = _re.search(r'(\d+)', search)
        numeric_id = int(id_match.group(1)) if id_match else None
        conditions = [ChangeRequest.title.ilike(search_term), ChangeRequest.description.ilike(search_term)]
        if numeric_id: conditions.append(ChangeRequest.id == numeric_id)
        query = query.filter(or_(*conditions))
    if status:
        query = query.filter(ChangeRequest.status == status)
    if change_type:
        query = query.filter(ChangeRequest.change_type == change_type)
    if risk_level:
        query = query.filter(ChangeRequest.risk_level == risk_level)
    total = query.count()
    changes = query.order_by(ChangeRequest.created_at.desc()).offset(skip).limit(limit).all()
    req_ids = {c.requester_id for c in changes if c.requester_id}
    user_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(req_ids)).all()} if req_ids else {}
    return {"items": [_change_to_out(c, user_map) for c in changes], "total": total, "skip": skip, "limit": limit}


@router.get("/changes/calendar")
def get_change_calendar(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns all changes with dates for calendar view."""
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    changes = db.query(ChangeRequest).filter(
        ChangeRequest.tenant_id == current_user.tenant_id,
        (ChangeRequest.planned_date != None) | (ChangeRequest.start_date != None)
    ).order_by(ChangeRequest.planned_date).all()
    return [{"id": c.id, "title": c.title, "change_type": str(c.change_type) if c.change_type else "normal",
             "risk_level": str(c.risk_level) if c.risk_level else "medium",
             "status": str(c.status) if c.status else "draft",
             "planned_date": c.planned_date.isoformat() if c.planned_date else None,
             "start_date": c.start_date.isoformat() if c.start_date else None,
             "end_date": c.end_date.isoformat() if c.end_date else None}
            for c in changes]


@router.get("/changes/{change_id}")
def get_change(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    from sqlalchemy import text as _t
    try:
        row = db.execute(_t(
            "SELECT id, title, description, change_type::text, risk_level::text, risk_score, "
            "status::text, requester_id, owner_id, assigned_to_id, "
            "planned_date, start_date, end_date, impact, rollback_plan, test_plan, "
            "cab_members, linked_ticket_ids, linked_asset_ids, "
            "post_review_notes, post_review_at, created_at, updated_at "
            "FROM change_requests WHERE id=:id AND tenant_id=:tid"
        ), {"id": change_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Change not found")

        def safe_json(val):
            if not val: return []
            try: return json.loads(val)
            except: return []

        def get_name(uid):
            if not uid: return ""
            try:
                u = db.execute(_t("SELECT full_name FROM users WHERE id=:id"), {"id": uid}).fetchone()
                return u[0] if u else ""
            except: return ""

        return {
            "id": row[0], "title": row[1], "description": row[2],
            "change_type": str(row[3]).lower() if row[3] else "normal",
            "risk_level": str(row[4]).lower() if row[4] else "medium",
            "risk_score": row[5],
            "status": str(row[6]).lower() if row[6] else "draft",
            "requester_id": row[7], "requester_name": get_name(row[7]),
            "owner_id": row[8], "owner_name": get_name(row[8]),
            "assigned_to_id": row[9], "assigned_to_name": get_name(row[9]),
            "planned_date": str(row[10]) if row[10] else None,
            "start_date": str(row[11]) if row[11] else None,
            "end_date": str(row[12]) if row[12] else None,
            "impact": row[13], "rollback_plan": row[14], "test_plan": row[15],
            "cab_members": safe_json(row[16]),
            "linked_ticket_ids": safe_json(row[17]),
            "linked_asset_ids": safe_json(row[18]),
            "post_review_notes": row[19],
            "post_review_at": str(row[20]) if row[20] else None,
            "created_at": str(row[21]) if row[21] else None,
            "updated_at": str(row[22]) if row[22] else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Change fetch error: {str(e)[:200]}")


@router.patch("/changes/{change_id}")
def update_change(change_id: int, update: ChangeUpdate,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.requester_id != current_user.id and not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Access denied")
    update_data = update.model_dump(exclude_unset=True)
    for json_field in ["cab_members", "linked_ticket_ids", "linked_asset_ids"]:
        if json_field in update_data:
            update_data[json_field] = json.dumps(update_data[json_field]) if update_data[json_field] is not None else None
    if "post_review_notes" in update_data and update_data["post_review_notes"]:
        change.post_review_at = datetime.utcnow()
    for field, value in update_data.items():
        setattr(change, field, value)
    db.commit()
    db.refresh(change)
    return _change_to_out(change, db=db)


@router.post("/changes/{change_id}/submit")
def submit_change_for_approval(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Move a Draft change to Pending Approval, notifying CAB members / approvers."""
    if not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.requester_id != current_user.id and not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Access denied")
    if change.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft changes can be submitted for approval")
    # Standard changes are pre-approved by policy — skip CAB review and go straight to Approved
    if change.change_type == "standard":
        change.status = "approved"
    else:
        change.status = "pending_approval"
    db.commit()
    db.refresh(change)
    # Notify approvers (admins/super_admins) that a change needs review
    if change.status == "pending_approval":
        approvers = db.query(User).filter(
            User.tenant_id == current_user.tenant_id,
            User.role.in_(['admin', 'super_admin', 'platform_admin']),
            User.is_active == True
        ).all()
        for approver in approvers:
            _cl = get_user_language(db, approver.email)
            if _cl == 'fr':
                _cs = f"Changement en attente d'approbation : #{change.id} {change.title}"
                _cb = f"Une demande de changement nécessite votre révision.\n\nType : {change.change_type}\nRisque : {str(change.risk_level) if change.risk_level else 'n/a'}"
                _cc = "Voir le changement →"
            else:
                _cs = f"Change pending your approval: #{change.id} {change.title}"
                _cb = f"A change request needs your review.\n\nType: {change.change_type}\nRisk: {str(change.risk_level) if change.risk_level else 'n/a'}"
                _cc = "View change →"
            send_email(approver.email, _cs, _cb, cta_url=f"{FRONTEND_URL}/changes/{change.id}", cta_label=_cc, db=None, tenant_id=change.tenant_id, lang=_cl)
    return _change_to_out(change, db=db)


@router.post("/changes/{change_id}/approve")
def approve_change(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Change is not in pending approval status")
    change.status = "approved"
    db.commit()
    db.refresh(change)
    requester = db.query(User).filter(User.id == change.requester_id).first()
    if requester:
        _cl2 = get_user_language(db, requester.email)
        if _cl2 == 'fr':
            _cs2 = f"Changement approuvé : #{change.id} {change.title}"
            _cb2 = f"Votre demande de changement a été approuvée."
            _cc2 = "Voir le changement →"
        else:
            _cs2 = f"Change approved: #{change.id} {change.title}"
            _cb2 = f"Your change request has been approved."
            _cc2 = "View change →"
        send_email(requester.email, _cs2, _cb2, cta_url=f"{FRONTEND_URL}/changes/{change.id}", cta_label=_cc2, db=None, tenant_id=change.tenant_id, lang=_cl2)
    return _change_to_out(change)


@router.post("/changes/{change_id}/reject")
def reject_change(change_id: int, comment: CommentCreate,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Change is not in pending approval status")
    change.status = "rejected"
    db.commit()
    db.refresh(change)
    requester = db.query(User).filter(User.id == change.requester_id).first()
    if requester:
        _cl3 = get_user_language(db, requester.email)
        if _cl3 == 'fr':
            _cs3 = f"Changement rejeté : #{change.id} {change.title}"
            _cb3 = f"Votre demande de changement a été rejetée.\nRaison : {comment.body}"
            _cc3 = "Voir le changement →"
        else:
            _cs3 = f"Change rejected: #{change.id} {change.title}"
            _cb3 = f"Your change request has been rejected.\nReason: {comment.body}"
            _cc3 = "View change →"
        send_email(requester.email, _cs3, _cb3, cta_url=f"{FRONTEND_URL}/changes/{change.id}", cta_label=_cc3, db=None, tenant_id=change.tenant_id, lang=_cl3)
    return _change_to_out(change)

def _change_to_out(change: ChangeRequest, user_map: dict = None, db=None) -> dict:
    if user_map is not None:
        requester_name = user_map.get(change.requester_id, "Unknown")
    else:
        try:
            requester_name = change.requester.full_name if change.requester else "Unknown"
        except Exception:
            requester_name = "Unknown"
    try:
        owner_name = change.owner.full_name if change.owner else ""
    except Exception:
        owner_name = ""
    try:
        assigned_name = change.assigned_to.full_name if change.assigned_to else ""
    except Exception:
        assigned_name = ""

    def _safe_json(val):
        if not val: return []
        try: return json.loads(val)
        except Exception: return []

    # Fetch CAB member names if db provided
    cab_ids = _safe_json(change.cab_members)
    cab_names = []
    if db and cab_ids:
        cab_users = db.query(User).filter(User.id.in_(cab_ids)).all()
        cab_names = [{"id": u.id, "name": u.full_name} for u in cab_users]

    return {
        "id": change.id,
        "title": change.title,
        "description": change.description,
        "change_type": str(change.change_type) if change.change_type else "normal",
        "risk_level": str(change.risk_level) if change.risk_level else "medium",
        "risk_score": change.risk_score,
        "status": str(change.status) if change.status else "draft",
        "requester_id": change.requester_id,
        "requester_name": requester_name,
        "owner_id": change.owner_id,
        "owner_name": owner_name,
        "assigned_to_id": change.assigned_to_id,
        "assigned_to_name": assigned_name,
        "planned_date": change.planned_date,
        "start_date": change.start_date,
        "end_date": change.end_date,
        "impact": change.impact,
        "rollback_plan": change.rollback_plan,
        "test_plan": change.test_plan,
        "cab_members": cab_ids,
        "cab_member_names": cab_names,
        "linked_ticket_ids": _safe_json(change.linked_ticket_ids),
        "linked_asset_ids": _safe_json(change.linked_asset_ids),
        "post_review_notes": change.post_review_notes,
        "post_review_at": change.post_review_at,
        "created_at": change.created_at,
        "updated_at": change.updated_at,
    }



@router.get("/changes/{change_id}/tasks")
def list_change_tasks(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    tasks = db.query(ChangeTask).filter(ChangeTask.change_id == change_id).order_by(ChangeTask.created_at).all()
    return [{"id": t.id, "title": t.title, "is_done": t.is_done,
             "assigned_to_id": t.assigned_to_id,
             "assigned_to_name": t.assigned_to.full_name if t.assigned_to else None,
             "created_at": t.created_at} for t in tasks]


@router.post("/changes/{change_id}/tasks")
def create_change_task(change_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    task = ChangeTask(change_id=change_id, title=data.get("title", "New Task"),
                      assigned_to_id=data.get("assigned_to_id"))
    db.add(task); db.commit(); db.refresh(task)
    return {"id": task.id, "title": task.title, "is_done": task.is_done}


@router.patch("/changes/{change_id}/tasks/{task_id}")
def update_change_task(change_id: int, task_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change request not found")
    task = db.query(ChangeTask).filter(ChangeTask.id == task_id, ChangeTask.change_id == change_id).first()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    for k in ["title", "is_done", "assigned_to_id"]:
        if k in data: setattr(task, k, data[k])
    db.commit()
    return {"ok": True}


@router.delete("/changes/{change_id}/tasks/{task_id}")
def delete_change_task(change_id: int, task_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change request not found")
    task = db.query(ChangeTask).filter(ChangeTask.id == task_id, ChangeTask.change_id == change_id).first()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task); db.commit()
    return {"ok": True}



@router.get("/changes/{change_id}/comments")
def list_change_comments(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    comments = db.query(ChangeComment).filter(ChangeComment.change_id == change_id).order_by(ChangeComment.created_at).all()
    return [{"id": c.id, "body": c.body, "is_internal": c.is_internal,
             "author_id": c.author_id,
             "author_name": c.author.full_name if c.author else "Unknown",
             "created_at": c.created_at} for c in comments]


@router.post("/changes/{change_id}/comments")
def add_change_comment(change_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    comment = ChangeComment(change_id=change_id, author_id=current_user.id,
                            body=data.get("body", ""), is_internal=data.get("is_internal", False))
    db.add(comment); db.commit(); db.refresh(comment)
    return {"id": comment.id, "body": comment.body, "created_at": comment.created_at}



@router.get("/approval-workflows/")
def list_workflows(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403)
    workflows = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.tenant_id == current_user.tenant_id,
        ApprovalWorkflow.is_active == True
    ).all()
    result = []
    for w in workflows:
        steps = []
        for s in w.steps:
            approver = db.query(User).filter(User.id == s.approver_id).first() if s.approver_id else None
            steps.append({
                "id": s.id, "step_order": s.step_order, "name": s.name,
                "approver_id": s.approver_id,
                "approver_name": approver.full_name if approver else None,
                "approver_role": s.approver_role,
            })
        result.append({
            "id": w.id, "name": w.name, "category": w.category,
            "ticket_type": w.ticket_type, "steps": steps,
        })
    return result


@router.post("/approval-workflows/")
def create_workflow(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if tenant and not get_plan_limits(tenant.plan)["approval_workflows"]:
        raise HTTPException(status_code=403, detail="Approval workflows are available on the Pro plan and above. Please upgrade your plan.")
    workflow = ApprovalWorkflow(
        tenant_id=admin.tenant_id,
        name=data.get("name", ""),
        category=data.get("category") or None,
        ticket_type=data.get("ticket_type", "service_request"),
    )
    db.add(workflow)
    db.flush()
    for i, step in enumerate(data.get("steps", []), start=1):
        db.add(ApprovalStep(
            workflow_id=workflow.id,
            step_order=i,
            name=step.get("name", f"Step {i}"),
            approver_id=int(step["approver_id"]) if step.get("approver_id") else None,
            approver_role=step.get("approver_role") or None,
        ))
    log_system_event(db, admin, "workflow.created",
                     target_type="workflow", target_id=workflow.id, target_label=workflow.name)
    db.commit()
    return {"id": workflow.id, "name": workflow.name}


@router.put("/approval-workflows/{workflow_id}")
def update_workflow(workflow_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    workflow = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.id == workflow_id,
        ApprovalWorkflow.tenant_id == admin.tenant_id
    ).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    workflow.name = data.get("name", workflow.name)
    workflow.category = data.get("category") or None
    workflow.ticket_type = data.get("ticket_type", workflow.ticket_type)

    # Replace all steps
    db.query(ApprovalStep).filter(ApprovalStep.workflow_id == workflow.id).delete()
    db.flush()
    for i, step in enumerate(data.get("steps", []), start=1):
        db.add(ApprovalStep(
            workflow_id=workflow.id,
            step_order=i,
            name=step.get("name", f"Step {i}"),
            approver_id=int(step["approver_id"]) if step.get("approver_id") else None,
            approver_role=step.get("approver_role") or None,
        ))
    log_system_event(db, admin, "workflow.updated",
                     target_type="workflow", target_id=workflow.id, target_label=workflow.name)
    db.commit()
    return {"id": workflow.id, "name": workflow.name}


@router.delete("/approval-workflows/{workflow_id}")
def delete_workflow(workflow_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    wf = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.id == workflow_id,
        ApprovalWorkflow.tenant_id == admin.tenant_id
    ).first()
    if not wf:
        raise HTTPException(status_code=404)
    log_system_event(db, admin, "workflow.deleted",
                     target_type="workflow", target_id=wf.id, target_label=wf.name)
    wf.is_active = False
    db.commit()
    return {"ok": True}
