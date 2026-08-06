"""
Ticket management — CRUD, comments, bulk actions, time tracking, views router.
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


@router.post("/tickets/bulk-action")
def bulk_ticket_action(
    data: BulkTicketAction,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Apply an action to multiple tickets at once."""
    if not data.ticket_ids:
        raise HTTPException(status_code=400, detail="No ticket IDs provided")
    if len(data.ticket_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 tickets per bulk action")

    # Load tickets (tenant-filtered)
    tickets = []
    for tid in data.ticket_ids:
        t = _ticket_tenant_filter(db.query(Ticket), tid, current_user).first()
        if t:
            tickets.append(t)

    if not tickets:
        raise HTTPException(status_code=404, detail="No accessible tickets found")

    updated = 0
    errors = []

    for ticket in tickets:
        try:
            if data.action == "assign":
                agent = db.query(User).filter(
                    User.id == int(data.value),
                    User.tenant_id == current_user.tenant_id
                ).first()
                if agent:
                    ticket.assigned_to_id = agent.id
                    log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                                    "assigned", field="assigned_to_id", new_value=str(agent.id))
                    updated += 1

            elif data.action == "status":
                new_status = str(data.value).lower()
                old_status = str(ticket.status).split(".")[-1].lower()
                ticket.status = new_status
                # SLA pause/resume
                if new_status in ("pending_user", "pending_vendor"):
                    pause_sla(ticket)
                elif new_status in ("open", "in_progress"):
                    resume_sla(ticket)
                elif new_status == "resolved":
                    ticket.resolved_at = ticket.resolved_at or datetime.utcnow()
                    resume_sla(ticket)
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                                "status_changed", field="status",
                                old_value=old_status, new_value=new_status)
                updated += 1

            elif data.action == "priority":
                ticket.priority = str(data.value).lower()
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                                "priority_changed", field="priority", new_value=data.value)
                updated += 1

            elif data.action == "tag":
                tags = json.loads(ticket.tags) if ticket.tags else []
                if data.value and data.value not in tags:
                    tags.append(data.value)
                    ticket.tags = json.dumps(tags)
                updated += 1

            elif data.action == "remove_tag":
                tags = json.loads(ticket.tags) if ticket.tags else []
                if data.value in tags:
                    tags.remove(data.value)
                    ticket.tags = json.dumps(tags)
                updated += 1

            elif data.action == "close":
                ticket.status = "closed"
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                                "status_changed", field="status",
                                old_value=str(ticket.status).split(".")[-1].lower(),
                                new_value="closed")
                updated += 1

            elif data.action == "delete":
                if not has_permission(current_user, Permission.DELETE_TICKETS):
                    errors.append(f"Ticket #{ticket.id}: insufficient permissions")
                    continue
                db.delete(ticket)
                updated += 1

            else:
                raise HTTPException(status_code=400, detail=f"Unknown action: {data.action}")

        except Exception as e:
            errors.append(f"Ticket #{ticket.id}: {str(e)}")

    db.commit()
    return {
        "ok": True,
        "updated": updated,
        "errors": errors,
        "message": f"{updated} ticket(s) updated successfully."
    }


@router.get("/tickets/")
def list_tickets(
    search: str | None = Query(None),
    assigned: str | None = Query(None),
    assigned_to_id: int | None = Query(None),
    status: str | None = Query(None),
    priority: str | None = Query(None),
    category: str | None = Query(None),
    ticket_type: str | None = Query(None),
    tag: str | None = Query(None),
    group_id: int | None = Query(None),
    asset_id: int | None = Query(None),
    resolved_after: str | None = Query(None, description="Resolved tickets updated after this ISO datetime"),
    updated_after: str | None = Query(None, description="Tickets updated after this ISO datetime"),
    due_date_from: str | None = Query(None, description="Tickets with due_date >= this ISO datetime"),
    due_date_to: str | None = Query(None, description="Tickets with due_date < this ISO datetime"),
    sort_by: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    tenant_id: int | None = Query(None),  # MSP filter by specific client tenant
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)

    # Platform admin (DodoDesk owner) — sees ALL tickets across ALL tenants
    if role == 'platform_admin':
        if tenant_id:
            query = db.query(Ticket).filter(Ticket.tenant_id == tenant_id)
        else:
            query = db.query(Ticket)  # no tenant filter — all tickets

    # Super admin (MSP) — sees tickets from their managed client tenants
    elif role == 'super_admin':
        from sqlalchemy import text as _t2
        access_rows = db.execute(_t2(
            "SELECT DISTINCT tenant_id FROM admin_tenant_access WHERE admin_user_id=:uid "
            "UNION SELECT :own_tid"
        ), {"uid": current_user.id, "own_tid": current_user.tenant_id}).fetchall()
        accessible_tenant_ids = [r[0] for r in access_rows]

        if tenant_id and tenant_id in accessible_tenant_ids:
            query = db.query(Ticket).filter(Ticket.tenant_id == tenant_id)
        elif len(accessible_tenant_ids) > 1:
            query = db.query(Ticket).filter(Ticket.tenant_id.in_(accessible_tenant_ids))
        else:
            query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)

    # Regular admin/agent/employee — own tenant only
    else:
        query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)

    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS):
        query = query.filter(Ticket.requester_id == current_user.id)

    if assigned == "me":
        query = query.filter(Ticket.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Ticket.assigned_to_id == None)

    if assigned_to_id:
        query = query.filter(Ticket.assigned_to_id == assigned_to_id)

    if resolved_after:
        try:
            after_dt = datetime.fromisoformat(resolved_after)
            query = query.filter(Ticket.updated_at >= after_dt)
        except ValueError:
            pass

    if updated_after:
        try:
            query = query.filter(Ticket.updated_at >= datetime.fromisoformat(updated_after))
        except ValueError:
            pass

    if due_date_from:
        try:
            query = query.filter(Ticket.due_date >= datetime.fromisoformat(due_date_from))
        except ValueError:
            pass

    if due_date_to:
        try:
            query = query.filter(Ticket.due_date < datetime.fromisoformat(due_date_to))
        except ValueError:
            pass

    if status:
        if status == "overdue":
            query = query.filter(
                Ticket.sla_resolution_deadline < datetime.utcnow(),
                Ticket.status.in_(['open','in_progress'])
            )
        elif status == "open":
            query = query.filter(Ticket.status.in_(['open','in_progress','pending_approval']))
        else:
            try:
                query = query.filter(Ticket.status == status.lower())
            except ValueError:
                pass

    if priority:
        try:
            query = query.filter(Ticket.priority == priority.lower())
        except ValueError:
            pass

    if category:
        query = query.filter(Ticket.category.ilike(f"%{_sql_safe_search(category)}%"))

    if ticket_type:
        try:
            query = query.filter(Ticket.ticket_type == ticket_type.lower())
        except ValueError:
            pass

    if tag:
        query = query.filter(Ticket.tags.ilike(f'%"{_sql_safe_search(tag)}"%'))

    if group_id:
        query = query.filter(Ticket.group_id == group_id)
    if asset_id:
        query = query.filter(Ticket.asset_id == asset_id)

    if search:
        term = f"%{search}%"
        try:
            ticket_id = int(search)
            query = query.filter(
                (Ticket.id == ticket_id) |
                (Ticket.title.ilike(term)) |
                (Ticket.description.ilike(term))
            )
        except ValueError:
            query = query.filter(
                (Ticket.title.ilike(term)) |
                (Ticket.description.ilike(term))
            )

    total = query.count()

    # Sorting
    if sort_by == "priority":
        from sqlalchemy import case
        priority_order = case(
            (Ticket.priority == 'critical', 0),
            (Ticket.priority == 'high', 1),
            (Ticket.priority == "medium", 2),
            (Ticket.priority == "low", 3),
            else_=4
        )
        query = query.order_by(priority_order, Ticket.created_at.desc())
    elif sort_by == "sla":
        query = query.order_by(Ticket.sla_resolution_deadline.asc().nullslast(), Ticket.created_at.desc())
    else:
        query = query.order_by(Ticket.created_at.desc())

    tickets = query.offset(skip).limit(limit).all()
    return {"items": [_ticket_to_out(t, db) for t in tickets], "total": total, "skip": skip, "limit": limit}


@router.patch("/tickets/{ticket_id}/link-asset")
def link_asset(ticket_id: int, link: LinkAssetRequest,
               current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ticket.asset_id = link.asset_id
    db.commit()
    db.refresh(ticket)
    try:
        return _ticket_to_out(ticket, db)
    except Exception:
        return {"ok": True, "asset_id": link.asset_id}

def _ticket_to_out(ticket: Ticket, db: Session = None) -> dict:
    requester = ticket.requester
    assigned = ticket.assigned_to if ticket.assigned_to_id else None
    watchers = []
    tenant_name = None
    if db:
        watcher_rows = db.query(TicketWatcher, User).join(
            User, TicketWatcher.user_id == User.id
        ).filter(TicketWatcher.ticket_id == ticket.id).all()
        watchers = [{"user_id": w.user_id, "full_name": u.full_name, "email": u.email}
                    for w, u in watcher_rows]
        try:
            t = db.query(Tenant).filter(Tenant.id == ticket.tenant_id).first()
            tenant_name = t.name if t else None
        except Exception:
            pass
    return {
        "id": ticket.id,
        "tenant_id": ticket.tenant_id,
        "tenant_name": tenant_name,
        "ticket_type": ticket.ticket_type,
        "title": ticket.title,
        "description": ticket.description,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "requester_id": ticket.requester_id,
        "requester_name": requester.full_name if requester else "Unknown",
        "assigned_to_id": ticket.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "assigned_to_availability": (assigned.availability or "online") if assigned else None,
        "asset_id": ticket.asset_id,
        "sla_response_deadline": ticket.sla_response_deadline,
        "sla_resolution_deadline": ticket.sla_resolution_deadline,
        "sla_status": compute_sla_status(ticket),
        "first_response_at": ticket.first_response_at,
        "tags": json.loads(ticket.tags) if ticket.tags else [],
        "merged_into_id": ticket.merged_into_id,
        "group_id": ticket.group_id,
        "resolution_note": ticket.resolution_note,
        "resolved_at": ticket.resolved_at,
        "resolution_kb_article_id": ticket.resolution_kb_article_id,
        "created_at": ticket.created_at,
        "watchers": watchers,
    }



@router.post("/tickets/{ticket_id}/presence")
def update_presence(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called every 15s by the frontend to register/refresh presence on a ticket."""
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket_id not in _ticket_viewers:
        _ticket_viewers[ticket_id] = {}
    _ticket_viewers[ticket_id][current_user.id] = {
        "user_id": current_user.id,
        "full_name": current_user.full_name,
        "last_seen": datetime.utcnow().isoformat(),
    }
    cutoff = datetime.utcnow().timestamp() - 30
    others = [
        v for uid, v in _ticket_viewers.get(ticket_id, {}).items()
        if uid != current_user.id and
        datetime.fromisoformat(v["last_seen"]).timestamp() > cutoff
    ]
    return {"viewers": others}


@router.delete("/tickets/{ticket_id}/presence")
def remove_presence(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called when agent leaves the ticket page."""
    if ticket_id in _ticket_viewers:
        _ticket_viewers[ticket_id].pop(current_user.id, None)
    return {"ok": True}


@router.post("/tickets/{ticket_id}/merge")
def merge_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Merge ticket_id INTO primary_ticket_id. Moves comments/attachments, closes duplicate."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    primary_id = data.get("primary_ticket_id")
    if not primary_id:
        raise HTTPException(status_code=400, detail="primary_ticket_id is required")
    if primary_id == ticket_id:
        raise HTTPException(status_code=400, detail="Cannot merge a ticket into itself")

    duplicate = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    primary = db.query(Ticket).filter(Ticket.id == primary_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not duplicate or not primary:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if duplicate.merged_into_id:
        raise HTTPException(status_code=400, detail="This ticket has already been merged")

    # Move all comments to primary ticket
    db.query(Comment).filter(Comment.ticket_id == ticket_id).update({"ticket_id": primary_id})
    # Move attachments
    db.query(Attachment).filter(Attachment.ticket_id == ticket_id).update({"ticket_id": primary_id})

    # Add a system note on both tickets
    merge_note = Comment(
        ticket_id=primary_id,
        author_id=current_user.id,
        body=f"🔀 Ticket #{ticket_id} was merged into this ticket by {current_user.full_name}.",
        is_internal=True
    )
    db.add(merge_note)

    # Close the duplicate and mark as merged
    duplicate.status = "closed"
    duplicate.merged_into_id = primary_id
    log_ticket_event(db, ticket_id, duplicate.tenant_id, current_user.id,
                     action="merged", note=f"Merged into #{primary_id}")
    log_ticket_event(db, primary_id, primary.tenant_id, current_user.id,
                     action="merge_received", note=f"Received merge from #{ticket_id}")
    db.commit()
    return {"ok": True, "primary_id": primary_id, "merged_id": ticket_id}



@router.get("/tickets/{ticket_id}/time-entries")
def list_time_entries(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    entries = db.query(TimeEntry).filter(TimeEntry.ticket_id == ticket_id).order_by(TimeEntry.logged_at.desc()).all()
    total_minutes = sum(e.minutes for e in entries)
    return {
        "entries": [{
            "id": e.id,
            "agent_name": e.agent.full_name if e.agent else "Unknown",
            "agent_id": e.agent_id,
            "minutes": e.minutes,
            "hours": round(e.minutes / 60, 2),
            "note": e.note,
            "logged_at": e.logged_at,
        } for e in entries],
        "total_minutes": total_minutes,
        "total_hours": round(total_minutes / 60, 2),
    }


@router.post("/tickets/{ticket_id}/time-entries")
def log_time(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    minutes = data.get("minutes")
    if not minutes or int(minutes) <= 0:
        raise HTTPException(status_code=400, detail="Minutes must be a positive number")
    entry = TimeEntry(
        ticket_id=ticket_id,
        agent_id=current_user.id,
        minutes=int(minutes),
        note=data.get("note", "").strip() or None,
    )
    db.add(entry)
    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                     action="time_logged", note=f"{minutes}min logged by {current_user.full_name}")
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "minutes": entry.minutes, "note": entry.note, "logged_at": entry.logged_at}


@router.delete("/tickets/{ticket_id}/time-entries/{entry_id}")
def delete_time_entry(ticket_id: int, entry_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Verify the ticket belongs to the current user's tenant first
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id, TimeEntry.ticket_id == ticket_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.agent_id != current_user.id and not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Can only delete your own time entries")
    db.delete(entry)
    db.commit()
    return {"ok": True}



@router.get("/tickets/{ticket_id}/links")
def get_ticket_links(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Children of this ticket
    children = db.query(TicketLink).filter(TicketLink.parent_id == ticket_id).all()
    # Parent of this ticket
    parent_link = db.query(TicketLink).filter(TicketLink.child_id == ticket_id).first()

    def ticket_summary(t_id):
        t = db.query(Ticket).filter(Ticket.id == t_id).first()
        if not t: return None
        return {"id": t.id, "title": t.title, "status": str(t.status) if t.status else "", "ticket_type": str(t.ticket_type) if t.ticket_type else ""}

    return {
        "parent": ticket_summary(parent_link.parent_id) if parent_link else None,
        "children": [ticket_summary(c.child_id) for c in children if ticket_summary(c.child_id)],
    }


@router.post("/tickets/{ticket_id}/links")
def link_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    child_id = data.get("child_id")
    if not child_id:
        raise HTTPException(status_code=400, detail="child_id is required")
    if int(child_id) == ticket_id:
        raise HTTPException(status_code=400, detail="A ticket cannot be its own child")
    # Verify both tickets belong to this tenant
    parent = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    child = db.query(Ticket).filter(Ticket.id == child_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not parent or not child:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Check not already linked
    existing = db.query(TicketLink).filter(TicketLink.parent_id == ticket_id, TicketLink.child_id == child_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already linked")
    link = TicketLink(parent_id=ticket_id, child_id=int(child_id), tenant_id=current_user.tenant_id)
    db.add(link)
    log_ticket_event(db, ticket_id, current_user.tenant_id, current_user.id,
                     action="child_linked", note=f"Linked child ticket #{child_id}")
    db.commit()
    return {"ok": True, "parent_id": ticket_id, "child_id": child_id}


@router.delete("/tickets/{ticket_id}/links/{child_id}")
def unlink_ticket(ticket_id: int, child_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    link = db.query(TicketLink).filter(TicketLink.parent_id == ticket_id, TicketLink.child_id == child_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"ok": True}



@router.post("/tickets/{ticket_id}/reopen")
def reopen_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Re-open a resolved or closed ticket. Agents/admins only."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status not in ["resolved", "closed"]:
        raise HTTPException(status_code=400, detail="Only resolved or closed tickets can be reopened.")
    old_status = (str(ticket.status) if hasattr(ticket.status, "value") else str(ticket.status))
    ticket.status = "open"
    ticket.csat_token = None  # Reset CSAT so it can be re-sent on next resolution
    log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                     action="status_changed", field="status",
                     old_value=old_status, new_value="open")
    db.commit()
    db.refresh(ticket)
    # Notify requester
    requester = db.query(User).filter(User.id == ticket.requester_id).first()
    if requester and requester.id != current_user.id:
        _rl2 = get_user_language(db, requester.email)
        if _rl2 == 'fr':
            _rs2 = f"Ticket rouvert : {ticket.title}"
            _rb2 = f"Bonjour {requester.full_name},\n\nVotre ticket \"{ticket.title}\" a été rouvert et est en cours de traitement."
        else:
            _rs2 = f"Ticket reopened: {ticket.title}"
            _rb2 = f"Hi {requester.full_name},\n\nYour ticket \"{ticket.title}\" has been reopened and is being worked on again."
        send_email(requester.email, _rs2, _rb2, cta_url=f"{FRONTEND_URL}/tickets/{ticket.id}", cta_label="View ticket →" if _rl2 != 'fr' else "Voir le ticket →", db=None, tenant_id=ticket.tenant_id, lang=_rl2)
    return _ticket_to_out(ticket, db)

# ---------- Ticket Watchers ----------

def _notify_watchers(ticket: Ticket, event: str, actor: User, db: Session, exclude_user_id: int = None):
    """Send email notifications to all watchers of a ticket."""
    watchers = db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket.id).all()
    prefix = "INC" if str(ticket.ticket_type) == 'incident' else "REQ"
    ticket_ref = f"{prefix}-{ticket.id:04d}"
    for w in watchers:
        if w.user_id == exclude_user_id:
            continue
        watcher_user = db.query(User).filter(User.id == w.user_id).first()
        if watcher_user:
            _wl = get_user_language(db, watcher_user.email)
            if _wl == 'fr':
                _ws = f"[Observation] {ticket_ref} : {ticket.title} — {event}"
                _wb = (f"Bonjour {watcher_user.full_name},\n\n"
                       f"Mise à jour d'un ticket que vous observez :\n\n"
                       f"Ticket : {ticket_ref} — {ticket.title}\n"
                       f"Mise à jour : {event}\n"
                       f"Par : {actor.full_name}\n\n")
            else:
                _ws = f"[Watching] {ticket_ref}: {ticket.title} — {event}"
                _wb = (f"Hi {watcher_user.full_name},\n\n"
                       f"An update on a ticket you're watching:\n\n"
                       f"Ticket: {ticket_ref} — {ticket.title}\n"
                       f"Update: {event}\n"
                       f"By: {actor.full_name}\n\n")
            send_email(
                watcher_user.email, _ws, _wb,
                f"To stop watching this ticket, open it and click 'Unwatch'."
            )


@router.get("/tickets/{ticket_id}/watchers")
def get_watchers(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all watchers for a ticket."""
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    rows = db.query(TicketWatcher, User).join(User, TicketWatcher.user_id == User.id).filter(
        TicketWatcher.ticket_id == ticket_id
    ).all()
    return [{"user_id": w.user_id, "full_name": u.full_name, "email": u.email} for w, u in rows]


@router.post("/tickets/{ticket_id}/watch")
def watch_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Add current user as a watcher."""
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    existing = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == current_user.id
    ).first()
    if existing:
        return {"ok": True, "watching": True, "message": "Already watching"}
    db.add(TicketWatcher(ticket_id=ticket_id, user_id=current_user.id, tenant_id=current_user.tenant_id))
    db.commit()
    return {"ok": True, "watching": True, "message": f"You are now watching ticket {ticket_id}"}


@router.delete("/tickets/{ticket_id}/watch")
def unwatch_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove current user as a watcher."""
    watcher = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == current_user.id
    ).first()
    if watcher:
        db.delete(watcher)
        db.commit()
    return {"ok": True, "watching": False}


@router.post("/tickets/{ticket_id}/watchers/add")
def add_watcher(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Agent/admin adds another user as a watcher."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    user_id = data.get("user_id")
    user = db.query(User).filter(User.id == user_id, User.tenant_id == current_user.tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == user_id
    ).first()
    if not existing:
        db.add(TicketWatcher(ticket_id=ticket_id, user_id=user_id, tenant_id=current_user.tenant_id))
        db.commit()
    return {"ok": True, "message": f"{user.full_name} is now watching this ticket"}


@router.delete("/tickets/{ticket_id}/watchers/{user_id}")
def remove_watcher(ticket_id: int, user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Agent/admin removes a watcher."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    watcher = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == user_id,
        TicketWatcher.tenant_id == current_user.tenant_id
    ).first()
    if watcher:
        db.delete(watcher)
        db.commit()
    return {"ok": True}

# ---------- Approval workflow ----------

@router.get("/tickets/{ticket_id}/audit-log")
def get_audit_log(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    entries = db.query(TicketAuditLog).filter(
        TicketAuditLog.ticket_id == ticket_id
    ).order_by(TicketAuditLog.created_at.asc()).all()
    result = []
    for e in entries:
        actor = db.query(User).filter(User.id == e.actor_id).first()
        result.append({
            "id": e.id,
            "action": e.action,
            "field": e.field,
            "old_value": e.old_value,
            "new_value": e.new_value,
            "note": e.note,
            "actor_name": actor.full_name if actor else "Unknown",
            "created_at": e.created_at,
        })
    return result


@router.post("/tickets/{ticket_id}/create-kb-article")
def create_kb_from_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a KB article pre-filled from ticket resolution note. Links it back to the ticket."""
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    title = data.get("title", ticket.title)
    content = data.get("content") or ticket.resolution_note or ""
    category = data.get("category", ticket.category or "General")
    if not content:
        raise HTTPException(status_code=400, detail="Resolution note is empty — add a resolution note before creating a KB article")
    article = KBArticle(tenant_id=current_user.tenant_id, title=title, content=content,
                        category=category, author_id=current_user.id, status="draft", version=1)
    db.add(article)
    db.flush()
    # Initial version snapshot
    db.add(KBVersion(article_id=article.id, version_number=1, title=title, content=content,
                     category=category, status="draft",
                     change_note="Created from ticket resolution", edited_by_id=current_user.id))
    db.add(article)
    db.flush()
    # Link the article back to the ticket
    ticket.resolution_kb_article_id = article.id
    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                     action="kb_created", note=f"KB article created from resolution: {title}")
    db.commit()
    db.refresh(article)
    return {"id": article.id, "title": article.title, "category": article.category, "created_at": article.created_at}


@router.get("/tickets/{ticket_id}/approvals")
def get_ticket_approvals(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    approvals = db.query(TicketApproval).filter(
        TicketApproval.ticket_id == ticket_id
    ).order_by(TicketApproval.step_order).all()
    result = []
    for a in approvals:
        approver = db.query(User).filter(User.id == a.approver_id).first() if a.approver_id else None
        result.append({
            "id": a.id, "step_order": a.step_order, "step_name": a.step_name,
            "approver_id": a.approver_id,
            "approver_name": approver.full_name if approver else None,
            "approver_role": a.approver_role,
            "status": a.status, "comment": a.comment,
            "decided_at": a.decided_at,
        })
    return result


@router.post("/tickets/{ticket_id}/approvals/{approval_id}/decide")
def decide_approval(ticket_id: int, approval_id: int, data: dict,
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Verify ticket belongs to current user's tenant before processing approval
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    approval = db.query(TicketApproval).filter(
        TicketApproval.id == approval_id,
        TicketApproval.ticket_id == ticket_id,
        TicketApproval.status == "pending"
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval step not found or already decided")

    # Check permission — must be the designated approver or have the right role
    can_approve = has_permission(current_user, Permission.EDIT_TICKETS)
    if approval.approver_id and approval.approver_id != current_user.id and not can_approve:
        raise HTTPException(status_code=403, detail="You are not the designated approver for this step")
    if approval.approver_role and (current_(user.role.value if hasattr(user.role, "value") else str(user.role)) if hasattr(current_user.role, "value") else str(current_user.role)) != approval.approver_role and not can_approve:
        raise HTTPException(status_code=403, detail="You do not have the required role to approve this step")

    decision = data.get("decision")  # "approved" or "rejected"
    comment = data.get("comment", "")
    if decision not in ["approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Decision must be 'approved' or 'rejected'")

    approval.status = decision
    approval.comment = comment
    approval.decided_at = datetime.utcnow()

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()

    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
        action=decision,
        note=f"Step {approval.step_order} ({approval.step_name}): {decision}" + (f" — {comment}" if comment else ""))

    if decision == "rejected":
        ticket.status = "closed"
        # Mark remaining steps as skipped
        db.query(TicketApproval).filter(
            TicketApproval.ticket_id == ticket_id,
            TicketApproval.status.in_(["pending", "waiting"])
        ).update({"status": "skipped"})
        # Notify requester
        create_notification(db, ticket.requester_id, ticket.tenant_id,
            "approval_rejected",
            f"❌ Request rejected: {ticket.title}",
            f'Your request was rejected at step {approval.step_order} ({approval.step_name}).' + (f' Reason: {comment}' if comment else ''),
            f"/tickets/{ticket_id}")
    else:
        # Activate next step if exists
        next_approval = db.query(TicketApproval).filter(
            TicketApproval.ticket_id == ticket_id,
            TicketApproval.step_order == approval.step_order + 1
        ).first()

        if next_approval:
            next_approval.status = "pending"
            # Notify next approver
            if next_approval.approver_id:
                create_notification(db, next_approval.approver_id, ticket.tenant_id,
                    "approval_required",
                    f"✅ Approval required: {ticket.title}",
                    f'Step {next_approval.step_order}: {next_approval.step_name}',
                    f"/tickets/{ticket_id}")
            elif next_approval.approver_role:
                approvers = db.query(User).filter(
                    User.tenant_id == ticket.tenant_id,
                    User.role == next_approval.approver_role,
                    User.is_active == True
                ).all()
                for approver in approvers:
                    create_notification(db, approver.id, ticket.tenant_id,
                        "approval_required",
                        f"✅ Approval required: {ticket.title}",
                        f'Step {next_approval.step_order}: {next_approval.step_name}',
                        f"/tickets/{ticket_id}")
        else:
            # All steps approved — move ticket to open
            ticket.status = "open"
            create_notification(db, ticket.requester_id, ticket.tenant_id,
                "approval_approved",
                f"✅ Request approved: {ticket.title}",
                "All approval steps completed. Your request is now being processed.",
                f"/tickets/{ticket_id}")

    db.commit()
    return {"ok": True, "decision": decision}



@router.post("/tickets/bulk-update")
def bulk_update_tickets(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Bulk update tickets. Payload:
      { "ticket_ids": [1,2,3], "action": "assign"|"status"|"priority",
        "value": "user_id"|"open"|"high" }
    Only agents and admins can bulk-update.
    """
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    ticket_ids = payload.get("ticket_ids", [])
    action = payload.get("action")
    value = payload.get("value")

    if not ticket_ids or not action or value is None:
        raise HTTPException(status_code=400, detail="ticket_ids, action and value are required")

    tickets = db.query(Ticket).filter(
        Ticket.id.in_(ticket_ids),
        Ticket.tenant_id == current_user.tenant_id
    ).all()

    if not tickets:
        raise HTTPException(status_code=404, detail="No tickets found")

    updated = 0
    for ticket in tickets:
        try:
            if action == "assign":
                new_assignee_id = int(value) if value else None
                old_name = db.query(User).filter(User.id == ticket.assigned_to_id).first()
                new_name = db.query(User).filter(User.id == new_assignee_id).first()
                ticket.assigned_to_id = new_assignee_id
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="assigned", field="assigned_to",
                    old_value=old_name.full_name if old_name else "Unassigned",
                    new_value=new_name.full_name if new_name else "Unassigned")
                # Notify new assignee
                if new_assignee_id and new_assignee_id != current_user.id:
                    create_notification(db, new_assignee_id, ticket.tenant_id,
                        "ticket_assigned",
                        f"Ticket {ticket.id} assigned to you",
                        f'"{ticket.title}" has been assigned to you.',
                        f"/tickets/{ticket.id}")

            elif action == "status":
                old_status = (str(ticket.status) if hasattr(ticket.status, "value") else str(ticket.status))
                ticket.status = str(value).lower()
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="status_changed", field="status",
                    old_value=old_status, new_value=value)

            elif action == "priority":
                ticket.priority = str(value).lower()
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="status_changed", field="priority",
                    old_value=str(ticket.priority), new_value=value)

            elif action == "assign_group":
                new_group_id = int(value) if value else None
                ticket.group_id = new_group_id
                group = db.query(Group).filter(Group.id == new_group_id).first() if new_group_id else None
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="group_assigned", field="group_id",
                    new_value=group.name if group else "Unassigned")

            updated += 1
        except Exception:
            continue

    db.commit()
    return {"updated": updated, "total": len(ticket_ids)}

# NOTIFICATIONS


@router.post("/inbound-email")
async def inbound_email(request: Request, db: Session = Depends(get_db)):
    """
    Process inbound email and create/update ticket.
    Accepts JSON from email providers (Resend, SendGrid, Cloudmailin).
    Set up your email provider to POST to this endpoint.
    """
    try:
        body = await request.json()
    except Exception:
        # Try form data (some providers send multipart)
        form = await request.form()
        body = dict(form)

    # Normalise fields across different email providers
    to_addr      = (body.get("to") or body.get("recipient") or "").lower()
    from_email   = (body.get("from") or body.get("sender") or body.get("from_email") or "").lower()
    from_name    = body.get("from_name") or body.get("name") or from_email.split("@")[0]
    subject      = body.get("subject") or "No subject"
    text_body    = body.get("text") or body.get("plain") or body.get("body-plain") or ""
    html_body    = body.get("html") or body.get("body-html") or ""
    message_id   = body.get("message-id") or body.get("Message-Id") or ""
    in_reply_to  = body.get("in-reply-to") or body.get("In-Reply-To") or ""

    if not from_email:
        return {"ok": False, "error": "No sender email"}

    # Find tenant from recipient address
    # Format: tickets+{tenant_slug}@yourdomain.com OR {tenant_slug}@tickets.yourdomain.com
    tenant = None
    import re as _re
    slug_match = _re.search(r'tickets\+([a-z0-9-]+)@|^([a-z0-9-]+)@tickets\.', to_addr)
    if slug_match:
        slug = slug_match.group(1) or slug_match.group(2)
        tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.is_active == True).first()

    if not tenant:
        # Fallback: find any active tenant (single-tenant setup)
        tenant = db.query(Tenant).filter(Tenant.is_active == True).first()

    if not tenant:
        return {"ok": False, "error": "Tenant not found"}

    # Check if this is a REPLY to an existing ticket (via In-Reply-To header)
    # Ticket emails have message IDs like: <ticket-{id}@dododesk.dodobay.com>
    existing_ticket = None
    if in_reply_to:
        tid_match = _re.search(r'ticket-(\d+)@', in_reply_to)
        if tid_match:
            existing_ticket = db.query(Ticket).filter(
                Ticket.id == int(tid_match.group(1)),
                Ticket.tenant_id == tenant.id
            ).first()

    # Find or create user from sender email
    user = db.query(User).filter(
        func.lower(User.email) == from_email,
        User.tenant_id == tenant.id
    ).first()

    if not user:
        # Create a requester account for the sender
        user = User(
            email=from_email,
            full_name=from_name or from_email.split("@")[0],
            hashed_password=get_password_hash(uuid.uuid4().hex),  # random password
            role="requester",
            tenant_id=tenant.id,
            is_active=True,
        )
        db.add(user)
        db.flush()

    # Use plain text body, strip quoted replies
    body_text = text_body or ""
    # Remove quoted reply text (lines starting with >)
    body_lines = [l for l in body_text.split("\n") if not l.strip().startswith(">")]
    body_clean = "\n".join(body_lines).strip()[:5000]  # cap at 5000 chars

    if existing_ticket:
        # Add as a comment to existing ticket
        if body_clean:
            comment = Comment(
                ticket_id=existing_ticket.id,
                author_id=user.id,
                body=body_clean,
                is_internal=False,
                source="email",
            )
            db.add(comment)
            log_ticket_event(db, existing_ticket.id, tenant.id, user.id,
                           "commented", note=f"Via email reply")
            db.commit()
            return {"ok": True, "action": "comment_added", "ticket_id": existing_ticket.id}
    else:
        # Create new ticket
        title = subject.strip()
        # Remove common email prefixes
        for prefix in ["Re:", "RE:", "Fwd:", "FWD:", "Fw:"]:
            title = title.replace(prefix, "").strip()
        if not title:
            title = "Email ticket"

        # Compute SLA deadlines
        now = datetime.utcnow()
        try:
            resp, reso = compute_sla_deadlines("medium", now, db, tenant.id)
        except Exception:
            resp, reso = None, None

        new_ticket = Ticket(
            tenant_id=tenant.id,
            ticket_type="incident",
            title=title,
            description=body_clean,
            priority="medium",
            status="open",
            requester_id=user.id,
            sla_response_deadline=resp,
            sla_resolution_deadline=reso,
            source="email",
        )
        db.add(new_ticket)
        db.flush()

        log_ticket_event(db, new_ticket.id, tenant.id, user.id,
                        "created", note="Created via inbound email")

        # Run automation rules on new ticket
        try:
            run_automation_rule(new_ticket, "on_create", db, user)
        except Exception:
            pass

        db.commit()

        # Send confirmation email to requester
        try:
            cfg = get_email_config(db, tenant.id)
            lang = get_user_language(db, user.email)
            ref = f"INC{str(new_ticket.id).zfill(6)}"
            if lang == "fr":
                subj = f"✅ Ticket créé : {ref} — {title}"
                body_email = f"Bonjour {user.full_name},\n\nVotre demande a été enregistrée sous la référence {ref}.\nNous reviendrons vers vous dans les meilleurs délais."
            else:
                subj = f"✅ Ticket created: {ref} — {title}"
                body_email = f"Hi {user.full_name},\n\nYour request has been logged as {ref}.\nWe will get back to you as soon as possible."
            ticket_url = f"{FRONTEND_URL}/tickets/{new_ticket.id}"
            import threading as _th
            _th.Thread(target=send_email, args=(user.email, subj, body_email, cfg),
                      kwargs={"cta_url": ticket_url, "cta_label": "View Ticket →",
                              "db": None, "tenant_id": tenant.id, "lang": lang},
                      daemon=True).start()
        except Exception as e:
            print(f"⚠️ Email-to-ticket confirmation email failed: {e}")

        return {"ok": True, "action": "ticket_created", "ticket_id": new_ticket.id, "ref": ref}


@router.get("/inbound-email/config")
def get_inbound_email_config(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Return the inbound email address for this tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    slug = tenant.slug if tenant else "your-org"
    return {
        "inbound_address": f"tickets+{slug}@dodobay.com",
        "webhook_url": f"{API_URL}/inbound-email",
        "instructions": (
            "Set up email forwarding: create a rule to forward emails sent to "
            f"tickets+{slug}@dodobay.com to the webhook URL above using "
            "Resend Inbound, SendGrid Inbound Parse, or Cloudmailin."
        )
    }



@router.get("/ticket-views/")
def list_ticket_views(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    views = db.query(TicketView).filter(
        TicketView.tenant_id == current_user.tenant_id,
        (TicketView.is_shared == True) | (TicketView.created_by_id == current_user.id)
    ).order_by(TicketView.sort_order, TicketView.name).all()
    return [{"id": v.id, "name": v.name, "filters": json.loads(v.filters) if v.filters else {},
             "is_shared": v.is_shared, "is_mine": v.created_by_id == current_user.id,
             "created_by": v.created_by.full_name if v.created_by else ""} for v in views]


@router.post("/ticket-views/")
def create_ticket_view(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    view = TicketView(
        tenant_id=current_user.tenant_id, created_by_id=current_user.id,
        name=data.get("name", "My View"),
        filters=json.dumps(data.get("filters", {})),
        is_shared=data.get("is_shared", False)
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return {"id": view.id, "name": view.name}


@router.put("/ticket-views/{view_id}")
def update_ticket_view(view_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    view = db.query(TicketView).filter(TicketView.id == view_id, TicketView.tenant_id == current_user.tenant_id,
                                       TicketView.created_by_id == current_user.id).first()
    if not view:
        raise HTTPException(status_code=404, detail="View not found or not yours")
    for k in ["name", "is_shared"]:
        if k in data:
            setattr(view, k, data[k])
    if "filters" in data:
        view.filters = json.dumps(data["filters"])
    db.commit()
    return {"ok": True}


@router.delete("/ticket-views/{view_id}")
def delete_ticket_view(view_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    view = db.query(TicketView).filter(TicketView.id == view_id, TicketView.tenant_id == current_user.tenant_id,
                                       TicketView.created_by_id == current_user.id).first()
    if not view:
        raise HTTPException(status_code=404, detail="View not found or not yours")
    db.delete(view)
    db.commit()
    return {"ok": True}



@router.get("/tickets/{ticket_id}/tasks")
def list_ticket_tasks(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    tasks = db.query(TicketTask).filter(TicketTask.ticket_id == ticket_id).order_by(TicketTask.created_at).all()
    return [{"id": t.id, "title": t.title, "is_done": t.is_done,
             "assigned_to_id": t.assigned_to_id,
             "assigned_to_name": t.assigned_to.full_name if t.assigned_to else None,
             "due_date": t.due_date, "created_at": t.created_at} for t in tasks]


@router.post("/tickets/{ticket_id}/tasks")
def create_ticket_task(ticket_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    task = TicketTask(
        ticket_id=ticket_id, title=data.get("title", "New Task"),
        assigned_to_id=data.get("assigned_to_id"),
        due_date=datetime.fromisoformat(data["due_date"]) if data.get("due_date") else None
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"id": task.id, "title": task.title, "is_done": task.is_done}


@router.patch("/tickets/{ticket_id}/tasks/{task_id}")
def update_ticket_task(ticket_id: int, task_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    task = db.query(TicketTask).filter(TicketTask.id == task_id, TicketTask.ticket_id == ticket_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    for k in ["title", "is_done", "assigned_to_id"]:
        if k in data:
            setattr(task, k, data[k])
    if "due_date" in data:
        task.due_date = datetime.fromisoformat(data["due_date"]) if data["due_date"] else None
    db.commit()
    return {"ok": True}


@router.delete("/tickets/{ticket_id}/tasks/{task_id}")
def delete_ticket_task(ticket_id: int, task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(TicketTask).filter(TicketTask.id == task_id, TicketTask.ticket_id == ticket_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}



@router.get("/tickets/{ticket_id}/problem-links")
def get_problem_links(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = _ticket_tenant_filter(db.query(Ticket), ticket_id, current_user).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # This ticket as problem — show linked incidents
    as_problem = db.query(ProblemLink).filter(ProblemLink.problem_ticket_id == ticket_id).all()
    # This ticket as incident — show its problem
    as_incident = db.query(ProblemLink).filter(ProblemLink.incident_ticket_id == ticket_id).all()
    def fmt(t_id):
        t = db.query(Ticket).filter(Ticket.id == t_id).first()
        return {"id": t.id, "title": t.title, "status": str(t.status) if t and t.status else "", "ticket_type": str(t.ticket_type) if t else ""} if t else None
    return {
        "linked_incidents": [fmt(l.incident_ticket_id) for l in as_problem if fmt(l.incident_ticket_id)],
        "linked_problem": fmt(as_incident[0].problem_ticket_id) if as_incident else None
    }


@router.post("/tickets/{ticket_id}/problem-links")
def link_problem(ticket_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Link ticket_id (incident) to a problem ticket."""
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    plan_requires("problem_management", tenant, "Problem management is available on the Pro plan and above. Please upgrade.")
    problem_id = data.get("problem_ticket_id")
    if not problem_id:
        raise HTTPException(status_code=400, detail="problem_ticket_id required")
    # Verify both tickets belong to tenant
    for tid in [ticket_id, problem_id]:
        t = db.query(Ticket).filter(Ticket.id == tid, Ticket.tenant_id == current_user.tenant_id).first()
        if not t:
            raise HTTPException(status_code=404, detail=f"Ticket {tid} not found")
    existing = db.query(ProblemLink).filter(ProblemLink.incident_ticket_id == ticket_id).first()
    if existing:
        existing.problem_ticket_id = problem_id
    else:
        db.add(ProblemLink(problem_ticket_id=problem_id, incident_ticket_id=ticket_id))
    db.commit()
    return {"ok": True}


@router.delete("/tickets/{ticket_id}/problem-links")
def unlink_problem(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(ProblemLink).filter(ProblemLink.incident_ticket_id == ticket_id).first()
    if link:
        db.delete(link)
        db.commit()
    return {"ok": True}

