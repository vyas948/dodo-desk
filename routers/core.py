"""
Core — health check, public endpoints, probe sinks router.
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


@router.get("/ping")

@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check endpoint for Render.
    Verifies the API is running and the database is reachable.
    Render pings this every 30s — if it fails, Render auto-restarts the service.
    """
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
