"""
Automation — rules, groups, custom fields, macros, templates router.
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


@router.get("/admin/automation-rules")
def list_automation_rules(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rules = db.query(AutomationRule).filter(AutomationRule.tenant_id == admin.tenant_id).order_by(AutomationRule.created_at.desc()).all()
    return [{"id": r.id, "name": r.name, "description": r.description, "is_active": r.is_active,
             "trigger": r.trigger, "conditions": json.loads(r.conditions) if r.conditions else [],
             "actions": json.loads(r.actions) if r.actions else [],
             "run_count": r.run_count or 0, "last_run_at": r.last_run_at, "created_at": r.created_at} for r in rules]


@router.post("/admin/automation-rules")
def create_automation_rule(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    plan_requires("workflow_automation", tenant, "Workflow Automation is available on the Growth plan and above. Please upgrade.")
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rule name is required")
    trigger = data.get("trigger", "")
    if trigger not in ["on_create", "on_update", "on_status_change", "time_based"]:
        raise HTTPException(status_code=400, detail="Invalid trigger")
    actions = data.get("actions", [])
    if not actions:
        raise HTTPException(status_code=400, detail="At least one action is required")
    rule = AutomationRule(
        tenant_id=admin.tenant_id, name=name,
        description=data.get("description", ""),
        trigger=trigger, is_active=data.get("is_active", True),
        conditions=json.dumps(data.get("conditions", [])),
        actions=json.dumps(actions)
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "name": rule.name, "trigger": rule.trigger, "is_active": rule.is_active,
            "conditions": json.loads(rule.conditions) if rule.conditions else [],
            "actions": json.loads(rule.actions), "run_count": 0, "created_at": rule.created_at}


@router.patch("/admin/automation-rules/{rule_id}")
def update_automation_rule(rule_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.tenant_id == admin.tenant_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field in ["name", "description", "trigger", "is_active"]:
        if field in data:
            setattr(rule, field, data[field])
    if "conditions" in data:
        rule.conditions = json.dumps(data["conditions"])
    if "actions" in data:
        rule.actions = json.dumps(data["actions"])
    db.commit()
    return {"id": rule.id, "name": rule.name, "is_active": rule.is_active, "trigger": rule.trigger}


@router.delete("/admin/automation-rules/{rule_id}")
def delete_automation_rule(rule_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.tenant_id == admin.tenant_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.post("/admin/automation-rules/{rule_id}/test")
def test_automation_rule(rule_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Test a rule against a specific ticket to see if it would fire."""
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.tenant_id == admin.tenant_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        raise HTTPException(status_code=400, detail="ticket_id required")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == admin.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    conditions = json.loads(rule.conditions) if rule.conditions else []
    results = []
    all_pass = True
    for c in conditions:
        passed = _evaluate_condition(ticket, c)
        results.append({"condition": c, "passed": passed})
        if not passed:
            all_pass = False
    return {"would_fire": all_pass, "condition_results": results,
            "actions": json.loads(rule.actions) if rule.actions else []}



@router.get("/groups/")
def list_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    groups = db.query(Group).filter(Group.tenant_id == current_user.tenant_id).all()
    result = []
    for g in groups:
        members = db.query(User).join(GroupMember, GroupMember.user_id == User.id)\
                    .filter(GroupMember.group_id == g.id).all()
        result.append({
            "id": g.id, "name": g.name, "description": g.description,
            "member_count": len(members),
            "members": [{"id": u.id, "full_name": u.full_name, "email": u.email} for u in members]
        })
    return result


@router.post("/groups/")
def create_group(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    group = Group(tenant_id=admin.tenant_id, name=name, description=data.get("description", ""))
    db.add(group)
    db.commit()
    db.refresh(group)
    # Add initial members if provided
    for uid in data.get("member_ids", []):
        user = db.query(User).filter(User.id == uid, User.tenant_id == admin.tenant_id).first()
        if user:
            db.add(GroupMember(group_id=group.id, user_id=uid))
    db.commit()
    return {"id": group.id, "name": group.name, "description": group.description}


@router.patch("/groups/{group_id}")
def update_group(group_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    group = db.query(Group).filter(Group.id == group_id, Group.tenant_id == admin.tenant_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if "name" in data: group.name = data["name"]
    if "description" in data: group.description = data["description"]
    if "member_ids" in data:
        db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
        for uid in data["member_ids"]:
            user = db.query(User).filter(User.id == uid, User.tenant_id == admin.tenant_id).first()
            if user:
                db.add(GroupMember(group_id=group_id, user_id=uid))
    db.commit()
    db.refresh(group)
    return {"id": group.id, "name": group.name, "description": group.description}


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    group = db.query(Group).filter(Group.id == group_id, Group.tenant_id == admin.tenant_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    # Unassign tickets from this group
    db.query(Ticket).filter(Ticket.group_id == group_id).update({"group_id": None})
    db.delete(group)
    db.commit()
    return {"ok": True}



@router.get("/admin/custom-fields")
def list_custom_fields(applies_to: str | None = Query(None),
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List custom field definitions. Optionally filter by applies_to scope.
    e.g. ?applies_to=asset returns fields scoped to assets only."""
    query = db.query(CustomField).filter(CustomField.tenant_id == current_user.tenant_id)
    if applies_to:
        # Return fields that match explicitly OR fields that apply to 'all'
        # Exception: when filtering for ticket types (incident/service_request/change),
        # also include 'all' fields. For asset/kb_article, return only exact matches.
        if applies_to in ('asset', 'kb_article'):
            query = query.filter(CustomField.applies_to == applies_to)
        else:
            query = query.filter(
                (CustomField.applies_to == applies_to) | (CustomField.applies_to == 'all')
            )
    fields = query.order_by(CustomField.sort_order).all()
    return [{"id": f.id, "name": f.name, "field_key": f.field_key, "field_type": f.field_type,
             "options": json.loads(f.options) if f.options else [],
             "is_required": f.is_required, "applies_to": f.applies_to, "sort_order": f.sort_order} for f in fields]


@router.post("/admin/custom-fields")
def create_custom_field(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Field name is required")
    field_key = re.sub(r'[^a-z0-9_]', '_', name.lower().replace(' ', '_'))
    # ensure unique key per tenant
    existing = db.query(CustomField).filter(CustomField.tenant_id == admin.tenant_id, CustomField.field_key == field_key).first()
    if existing:
        field_key = f"{field_key}_{int(datetime.utcnow().timestamp())}"
    field = CustomField(
        tenant_id=admin.tenant_id, name=name, field_key=field_key,
        field_type=data.get("field_type", "text"),
        options=json.dumps(data.get("options", [])) if data.get("options") else None,
        is_required=data.get("is_required", False),
        applies_to=data.get("applies_to", "all"),
        sort_order=data.get("sort_order", 0)
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return {"id": field.id, "name": field.name, "field_key": field.field_key,
            "field_type": field.field_type, "options": json.loads(field.options) if field.options else [],
            "is_required": field.is_required, "applies_to": field.applies_to}


@router.put("/admin/custom-fields/{field_id}")
def update_custom_field(field_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    field = db.query(CustomField).filter(CustomField.id == field_id, CustomField.tenant_id == admin.tenant_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    for k in ["name", "field_type", "is_required", "applies_to", "sort_order"]:
        if k in data:
            setattr(field, k, data[k])
    if "options" in data:
        field.options = json.dumps(data["options"]) if data["options"] else None
    db.commit()
    return {"ok": True}


@router.delete("/admin/custom-fields/{field_id}")
def delete_custom_field(field_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    field = db.query(CustomField).filter(CustomField.id == field_id, CustomField.tenant_id == admin.tenant_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(field)
    db.commit()
    return {"ok": True}



@router.get("/macros/")
def list_macros(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Macro).filter(Macro.tenant_id == current_user.tenant_id)
    query = query.filter((Macro.is_shared == True) | (Macro.created_by_id == current_user.id))
    macros = query.order_by(Macro.name).all()
    return [{"id": m.id, "name": m.name, "description": m.description,
             "actions": json.loads(m.actions) if m.actions else [],
             "is_shared": m.is_shared, "run_count": m.run_count or 0,
             "created_by": m.created_by.full_name if m.created_by else "Unknown"} for m in macros]


@router.post("/macros/")
def create_macro(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not has_permission(current_user, Permission.MANAGE_SETTINGS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    macro = Macro(
        tenant_id=current_user.tenant_id, name=data.get("name", "New Macro"),
        description=data.get("description", ""),
        actions=json.dumps(data.get("actions", [])),
        is_shared=data.get("is_shared", True),
        created_by_id=current_user.id
    )
    db.add(macro)
    db.commit()
    db.refresh(macro)
    return {"id": macro.id, "name": macro.name}


@router.put("/macros/{macro_id}")
def update_macro(macro_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    macro = db.query(Macro).filter(Macro.id == macro_id, Macro.tenant_id == current_user.tenant_id).first()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro not found")
    for k in ["name", "description", "is_shared"]:
        if k in data:
            setattr(macro, k, data[k])
    if "actions" in data:
        macro.actions = json.dumps(data["actions"])
    db.commit()
    return {"ok": True}


@router.delete("/macros/{macro_id}")
def delete_macro(macro_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    macro = db.query(Macro).filter(Macro.id == macro_id, Macro.tenant_id == current_user.tenant_id).first()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro not found")
    db.delete(macro)
    db.commit()
    return {"ok": True}


@router.post("/macros/{macro_id}/apply/{ticket_id}")
def apply_macro(macro_id: int, ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Apply a macro to a ticket — executes all actions in sequence."""
    macro = db.query(Macro).filter(Macro.id == macro_id, Macro.tenant_id == current_user.tenant_id).first()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro not found")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    actions = json.loads(macro.actions) if macro.actions else []
    applied = []
    for action in actions:
        act_type = action.get("type")
        val = action.get("value")
        try:
            if act_type == "set_status" and val:
                ticket.status = str(val).lower()
                applied.append(f"Status → {val}")
            elif act_type == "set_priority" and val:
                ticket.priority = str(val).lower()
                applied.append(f"Priority → {val}")
            elif act_type == "assign_to" and val:
                agent = db.query(User).filter(User.id == int(val), User.tenant_id == current_user.tenant_id).first()
                if agent:
                    ticket.assigned_to_id = agent.id
                    applied.append(f"Assigned → {agent.full_name}")
            elif act_type == "add_tag" and val:
                tags = json.loads(ticket.tags) if ticket.tags else []
                if val not in tags:
                    tags.append(val)
                    ticket.tags = json.dumps(tags)
                applied.append(f"Tag → {val}")
            elif act_type == "add_comment" and val:
                db.add(Comment(ticket_id=ticket_id, author_id=current_user.id, body=val, is_internal=action.get("is_internal", False)))
                applied.append("Comment added")
            elif act_type == "set_category" and val:
                ticket.category = val
                applied.append(f"Category → {val}")
        except Exception:
            pass
    ticket.updated_at = datetime.utcnow()
    macro.run_count = (macro.run_count or 0) + 1
    db.commit()
    return {"ok": True, "applied": applied}



@router.get("/ticket-templates/")
def list_ticket_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    templates = db.query(TicketTemplate).filter(TicketTemplate.tenant_id == current_user.tenant_id).order_by(TicketTemplate.name).all()
    return [{"id": t.id, "name": t.name, "ticket_type": t.ticket_type, "title": t.title,
             "description": t.description, "category": t.category, "priority": t.priority,
             "tags": json.loads(t.tags) if t.tags else []} for t in templates]


@router.post("/ticket-templates/")
def create_ticket_template(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tmpl = TicketTemplate(
        tenant_id=admin.tenant_id, name=data.get("name", "New Template"),
        ticket_type=data.get("ticket_type", "incident"),
        title=data.get("title", ""), description=data.get("description", ""),
        category=data.get("category", ""), priority=data.get("priority", "medium"),
        tags=json.dumps(data.get("tags", []))
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return {"id": tmpl.id, "name": tmpl.name}


@router.put("/ticket-templates/{tmpl_id}")
def update_ticket_template(tmpl_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tmpl = db.query(TicketTemplate).filter(TicketTemplate.id == tmpl_id, TicketTemplate.tenant_id == admin.tenant_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    for k in ["name", "ticket_type", "title", "description", "category", "priority"]:
        if k in data:
            setattr(tmpl, k, data[k])
    if "tags" in data:
        tmpl.tags = json.dumps(data["tags"])
    db.commit()
    return {"ok": True}


@router.delete("/ticket-templates/{tmpl_id}")
def delete_ticket_template(tmpl_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tmpl = db.query(TicketTemplate).filter(TicketTemplate.id == tmpl_id, TicketTemplate.tenant_id == admin.tenant_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tmpl)
    db.commit()
    return {"ok": True}

