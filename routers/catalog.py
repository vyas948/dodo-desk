"""
Service catalog — items, requests, MSP platform router.
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


@router.get("/catalog/")
def list_catalog_items(
    search: str | None = Query(None),
    category: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True
    )
    # Visibility filter
    if str(current_user.role) == "employee":
        query = query.filter(ServiceCatalogItem.visibility.in_(["all", "employees_only"]))
    elif str(current_user.role) in ["agent", "admin", "super_admin", "platform_admin"]:
        query = query.filter(ServiceCatalogItem.visibility.in_(["all", "agents_only"]))
    if search:
        query = query.filter(
            ServiceCatalogItem.name.ilike(f"%{_sql_safe_search(search)}%") |
            ServiceCatalogItem.description.ilike(f"%{_sql_safe_search(search)}%")
        )
    if category:
        query = query.filter(ServiceCatalogItem.category == category)
    items = query.order_by(ServiceCatalogItem.sort_order, ServiceCatalogItem.name).all()
    return [_catalog_to_out(i) for i in items]

def _catalog_to_out(item):
    return {
        "id": item.id, "tenant_id": item.tenant_id, "name": item.name, "description": item.description,
        "category": item.category, "estimated_cost": item.estimated_cost,
        "delivery_time_days": item.delivery_time_days, "approval_required": item.approval_required,
        "ticket_title": item.ticket_title or item.name,
        "ticket_description": item.ticket_description or item.description or "",
        "ticket_type": item.ticket_type or "service_request",
        "priority": item.priority or "medium",
        "is_onboarding": item.is_onboarding or False,
        "onboarding_tasks": json.loads(item.onboarding_tasks) if item.onboarding_tasks else [],
        "is_active": item.is_active, "is_featured": item.is_featured or False,
        "sort_order": item.sort_order or 0,
        "icon": item.icon or "📦",
        "request_form_fields": json.loads(item.request_form_fields) if item.request_form_fields else [],
        "visibility": item.visibility or "all",
        "sla_hours": item.sla_hours,
        "request_count": item.request_count or 0,
        "fulfillment_checklist": json.loads(item.fulfillment_checklist) if item.fulfillment_checklist else [],
        "approval_workflow_id": item.approval_workflow_id,
        "created_at": item.created_at,
    }


@router.get("/catalog/{item_id}")
def get_catalog_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    return _catalog_to_out(item)


@router.post("/catalog/")
def create_catalog_item(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    plan_requires("service_catalog", tenant, "Service Catalog is available on the Starter plan and above. Please upgrade.")
    if not data.get("category", "").strip():
        raise HTTPException(status_code=422, detail="Category is required")
    db_item = ServiceCatalogItem(
        tenant_id=current_user.tenant_id,
        name=data.get("name", ""),
        description=data.get("description", ""),
        category=data.get("category", ""),
        estimated_cost=data.get("estimated_cost"),
        delivery_time_days=data.get("delivery_time_days"),
        approval_required=data.get("approval_required", True),
        ticket_title=data.get("ticket_title", ""),
        ticket_description=data.get("ticket_description", ""),
        ticket_type=data.get("ticket_type", "service_request"),
        priority=data.get("priority", "medium"),
        is_onboarding=data.get("is_onboarding", False),
        onboarding_tasks=json.dumps(data.get("onboarding_tasks", [])),
        is_featured=data.get("is_featured", False),
        sort_order=data.get("sort_order", 0),
        icon=data.get("icon", "📦"),
        request_form_fields=json.dumps(data.get("request_form_fields", [])) if data.get("request_form_fields") else None,
        visibility=data.get("visibility", "all"),
        sla_hours=data.get("sla_hours"),
        fulfillment_checklist=json.dumps(data.get("fulfillment_checklist", [])) if data.get("fulfillment_checklist") else None,
        approval_workflow_id=data.get("approval_workflow_id"),
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return _catalog_to_out(db_item)


@router.put("/catalog/{item_id}")
def update_catalog_item(item_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    if "category" in data and not (data.get("category") or "").strip():
        raise HTTPException(status_code=422, detail="Category is required")
    for field in ["name","description","category","estimated_cost","delivery_time_days",
                  "approval_required","ticket_title","ticket_description","ticket_type",
                  "priority","is_onboarding","is_featured","sort_order","icon","visibility",
                  "sla_hours","approval_workflow_id"]:
        if field in data:
            setattr(item, field, data[field])
    for json_field in ["onboarding_tasks","request_form_fields","fulfillment_checklist"]:
        if json_field in data:
            setattr(item, json_field, json.dumps(data[json_field]) if data[json_field] else None)
    db.commit()
    return _catalog_to_out(item)


@router.post("/catalog/{item_id}/onboard")
def trigger_onboarding(item_id: int, data: dict,
                       current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    """
    Trigger onboarding for a new joiner.
    data: { employee_name, employee_email, start_date, manager_name, department }
    Creates one ticket per onboarding task, all linked by a shared reference.
    """
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True,
        ServiceCatalogItem.is_onboarding == True,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Onboarding catalog item not found")

    tasks = json.loads(item.onboarding_tasks) if item.onboarding_tasks else []
    if not tasks:
        raise HTTPException(status_code=400, detail="No onboarding tasks defined")

    employee_name = data.get("employee_name", "New Employee")
    employee_email = data.get("employee_email", "")
    start_date = data.get("start_date", "")
    manager_name = data.get("manager_name", "")
    department = data.get("department", "")

    now = datetime.utcnow()
    created_tickets = []

    for task in tasks:
        # Find assignee
        assignee_id = None
        if task.get("assign_to_id"):
            assignee_id = int(task["assign_to_id"])
        elif task.get("assign_to_role"):
            assignee = db.query(User).filter(
                User.tenant_id == current_user.tenant_id,
                User.role == task["assign_to_role"],
                User.is_active == True
            ).first()
            if assignee:
                assignee_id = assignee.id

        resp, reso = compute_sla_deadlines(
            task.get("priority", "medium"), now, db, current_user.tenant_id)

        description = task.get("description", "")
        # Substitute placeholders
        for placeholder, value in [
            ("{employee_name}", employee_name),
            ("{employee_email}", employee_email),
            ("{start_date}", start_date),
            ("{manager_name}", manager_name),
            ("{department}", department),
        ]:
            description = description.replace(placeholder, value)

        title = task.get("title", "Onboarding task").replace("{employee_name}", employee_name)

        ticket = Ticket(
            tenant_id=current_user.tenant_id,
            ticket_type="service_request",
            title=title,
            description=description,
            category=task.get("category", "Onboarding"),
            priority=str(task.get("priority", "medium")).lower(),
            requester_id=current_user.id,
            assigned_to_id=assignee_id,
            status="open",
            sla_response_deadline=resp,
            sla_resolution_deadline=reso,
            created_at=now,
        )
        db.add(ticket)
        db.flush()

        log_ticket_event(db, ticket.id, current_user.tenant_id, current_user.id,
            action="created",
            note=f'Onboarding ticket for {employee_name}: {title}')

        if assignee_id:
            create_notification(db, assignee_id, current_user.tenant_id,
                "ticket_assigned",
                f"🎉 Onboarding task: {title}",
                f"New joiner: {employee_name} · Start date: {start_date}",
                f"/tickets/{ticket.id}")

        created_tickets.append({"id": ticket.id, "title": title})

    db.commit()
    return {"created": len(created_tickets), "tickets": created_tickets}


@router.delete("/catalog/{item_id}")
def delete_catalog_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    item.is_active = False
    db.commit()
    return {"ok": True}


@router.get("/catalog/categories")
def get_catalog_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all distinct categories used in the catalog."""
    items = db.query(ServiceCatalogItem.category).filter(
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True,
        ServiceCatalogItem.category != None,
        ServiceCatalogItem.category != ""
    ).distinct().all()
    return sorted([i[0] for i in items if i[0]])


@router.patch("/catalog/{item_id}/sort")
def update_catalog_sort(item_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update sort order of a catalog item."""
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id, ServiceCatalogItem.tenant_id == current_user.tenant_id
    ).first()
    if item:
        item.sort_order = data.get("sort_order", 0)
        db.commit()
    return {"ok": True}



@router.get("/platform/msp/{super_admin_id}/clients")
def list_msp_clients(super_admin_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """List all client tenants assigned to a specific MSP super_admin. Platform admin only."""
    role = admin.role.value if hasattr(admin.role, 'value') else str(admin.role)
    if role != 'platform_admin':
        raise HTTPException(status_code=403, detail="Only platform admin can manage MSP client assignments")
    msp_user = db.query(User).filter(User.id == super_admin_id).first()
    if not msp_user:
        raise HTTPException(status_code=404, detail="MSP admin not found")
    granted = db.query(AdminTenantAccess).filter(AdminTenantAccess.admin_user_id == super_admin_id).all()
    result = []
    for g in granted:
        t = db.query(Tenant).filter(Tenant.id == g.tenant_id).first()
        if t:
            result.append({
                "id": t.id, "name": t.name, "slug": t.slug,
                "plan": t.plan, "is_active": t.is_active,
                "granted_at": str(g.granted_at)[:10]
            })
    return {"msp_user": {"id": msp_user.id, "name": msp_user.full_name, "email": msp_user.email}, "clients": result}


@router.post("/platform/msp/{super_admin_id}/clients")
def assign_client_to_msp(super_admin_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Assign a client tenant to an MSP super_admin. Platform admin only."""
    role = admin.role.value if hasattr(admin.role, 'value') else str(admin.role)
    if role != 'platform_admin':
        raise HTTPException(status_code=403, detail="Only platform admin can assign client tenants to MSPs")
    msp_user = db.query(User).filter(User.id == super_admin_id).first()
    if not msp_user:
        raise HTTPException(status_code=404, detail="MSP admin not found")
    msp_role = msp_user.role.value if hasattr(msp_user.role, 'value') else str(msp_user.role)
    if msp_role != 'super_admin':
        raise HTTPException(status_code=400, detail="Target user must be a super_admin (MSP admin)")
    tenant_id = data.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=422, detail="tenant_id is required")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.is_active == True).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    existing = db.query(AdminTenantAccess).filter(
        AdminTenantAccess.admin_user_id == super_admin_id,
        AdminTenantAccess.tenant_id == tenant_id
    ).first()
    if existing:
        return {"ok": True, "message": f"{tenant.name} is already assigned to this MSP"}
    db.add(AdminTenantAccess(admin_user_id=super_admin_id, tenant_id=tenant_id, granted_by_id=admin.id))
    log_system_event(db, admin, "platform.msp_client_assigned",
                     target_type="tenant", target_id=tenant_id,
                     target_label=f"{tenant.name} → {msp_user.full_name}")
    db.commit()
    return {"ok": True, "message": f"{tenant.name} assigned to {msp_user.full_name}"}


@router.delete("/platform/msp/{super_admin_id}/clients/{tenant_id}")
def remove_client_from_msp(super_admin_id: int, tenant_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Remove a client tenant from an MSP super_admin's scope. Platform admin only."""
    role = admin.role.value if hasattr(admin.role, 'value') else str(admin.role)
    if role != 'platform_admin':
        raise HTTPException(status_code=403, detail="Only platform admin can remove client tenant assignments")
    access = db.query(AdminTenantAccess).filter(
        AdminTenantAccess.admin_user_id == super_admin_id,
        AdminTenantAccess.tenant_id == tenant_id
    ).first()
    if not access:
        raise HTTPException(status_code=404, detail="Assignment not found")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    msp_user = db.query(User).filter(User.id == super_admin_id).first()
    db.delete(access)
    log_system_event(db, admin, "platform.msp_client_removed",
                     target_type="tenant", target_id=tenant_id,
                     target_label=f"{tenant.name if tenant else tenant_id} → {msp_user.full_name if msp_user else super_admin_id}")
    db.commit()
    return {"ok": True, "message": "Client tenant removed from MSP scope"}

