# ====================================================
# Complete ITSM – All Modules + Dark Mode (theme column)
# ====================================================

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, date
import enum
import os
import re
import smtplib
import json
import urllib.request
import urllib.error
import urllib.parse
import base64
import hashlib
import hmac as hmac_lib

# Cloudinary configuration
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET", "")

def upload_to_cloudinary(file_bytes: bytes, public_id: str, folder: str = "dodesk") -> str:
    """Upload a file to Cloudinary and return the secure URL."""
    if not CLOUDINARY_CLOUD_NAME or not CLOUDINARY_API_KEY or not CLOUDINARY_API_SECRET:
        raise HTTPException(status_code=500, detail="Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET environment variables.")

    timestamp = str(int(__import__('time').time()))
    full_public_id = f"{folder}/{public_id}"

    # Build signature
    params = f"public_id={full_public_id}&timestamp={timestamp}"
    signature = hashlib.sha1(f"{params}{CLOUDINARY_API_SECRET}".encode()).hexdigest()

    # Encode file as base64 data URI
    b64 = base64.b64encode(file_bytes).decode()

    # Detect mime type from first bytes
    if file_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        mime = 'image/png'
    elif file_bytes[:3] == b'\xff\xd8\xff':
        mime = 'image/jpeg'
    elif file_bytes[:4] == b'<svg' or b'<svg' in file_bytes[:100]:
        mime = 'image/svg+xml'
    else:
        mime = 'image/webp'

    data = urllib.parse.urlencode({
        'file': f"data:{mime};base64,{b64}",
        'public_id': full_public_id,
        'timestamp': timestamp,
        'api_key': CLOUDINARY_API_KEY,
        'signature': signature,
    }).encode()

    req = urllib.request.Request(
        f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/upload",
        data=data,
        method='POST'
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
    return result['secure_url']
import csv
import io
import uuid
import struct
import time as _time_module
from email.mime.text import MIMEText
from apscheduler.schedulers.background import BackgroundScheduler

from fastapi import FastAPI, Depends, HTTPException, status, Query, Header, UploadFile, File, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, Enum as SAEnum, ForeignKey, Text, Date, Float
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship
from sqlalchemy.sql import func as sa_func

# Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load .env file
from dotenv import load_dotenv
load_dotenv()

# =============================================================================
# DATABASE SETUP
# =============================================================================

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./test.db")

# Fix Neon/PostgreSQL URL scheme if needed
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs check_same_thread, PostgreSQL does not
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# =============================================================================
# SUBSCRIPTION PLANS
# =============================================================================

PLAN_LIMITS = {
    "free": {
        "label": "Free",
        "max_users": 1,
        "max_tenants": 1,       # free = their own company only, no client tenants
        "grace_users": 0,
        "trial_days": 14,
        "branding": False,
        "sla": False,
        "mfa": False,
        "sso": False,
        "approval_workflows": False,
        "ai_chatbot": False,
        "price_monthly": 0,
        "price_annual": 0,
        "price_per_extra_seat": 0,
    },
    "pro": {
        "label": "Pro",
        "max_users": 5,
        "max_tenants": 1,       # pro = their own company only, each company pays separately
        "grace_users": 5,
        "trial_days": None,
        "branding": True,
        "sla": True,
        "mfa": True,
        "sso": True,
        "approval_workflows": True,
        "ai_chatbot": False,
        "price_monthly": 59,
        "price_annual": 637,
        "price_per_extra_seat": 12,
    },
    "enterprise": {
        "label": "Enterprise",
        "max_users": None,       # unlimited
        "max_tenants": None,     # unlimited — for MSPs managing multiple clients
        "grace_users": 0,
        "trial_days": None,
        "branding": True,
        "sla": True,
        "mfa": True,
        "sso": True,
        "approval_workflows": True,
        "ai_chatbot": True,
        "price_monthly": None,
        "price_annual": None,
        "price_per_extra_seat": 0,
    },
}

def get_plan_limits(plan: str) -> dict:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

def check_tenant_limit(db: Session, admin: "User"):
    """Raise HTTPException if the admin's tenant has reached the plan's max_tenants.
    Only applies to regular admins — super_admin can always create tenants."""
    if admin.role == UserRole.SUPER_ADMIN:
        return  # super_admin is never limited

    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        return
    limits = get_plan_limits(tenant.plan)
    max_tenants = limits.get("max_tenants")
    if max_tenants is None:
        return  # unlimited (Enterprise)

    # Count tenants this admin has created (or just count all tenants — since each company
    # should have exactly 1, this effectively prevents any additional tenant creation)
    owned = db.query(Tenant).filter(Tenant.id == admin.tenant_id).count()
    if owned >= max_tenants:
        plan_label = limits["label"]
        raise HTTPException(
            status_code=403,
            detail=f"Your {plan_label} plan is limited to {max_tenants} tenant{'s' if max_tenants != 1 else ''}. "
                   f"Each company should have its own DodoDesk subscription. "
                   f"Contact us about Enterprise if you manage multiple client organisations."
        )



def get_trial_status(tenant: "Tenant") -> dict:
    """For Free-plan tenants, compute trial day count and expiry. Pro/Enterprise have no trial."""
    limits = get_plan_limits(tenant.plan)
    trial_days = limits.get("trial_days")
    if not trial_days or not tenant.created_at:
        return {"on_trial": False, "trial_days_remaining": None, "trial_expired": False}

    elapsed = datetime.utcnow() - tenant.created_at
    remaining = trial_days - elapsed.days
    return {
        "on_trial": True,
        "trial_days_remaining": max(remaining, 0),
        "trial_expired": remaining <= 0,
    }


def check_user_limit(db: Session, tenant_id: int, additional: int = 1, role: "UserRole | str | None" = None):
    """Raise HTTPException if adding `additional` staff (agent/admin/super_admin) would exceed the plan limit.
    Employees (end-users raising tickets) don't count toward the limit."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return
    limits = get_plan_limits(tenant.plan)
    max_users = limits["max_users"]
    if max_users is None:
        return  # unlimited

    # Employees don't count toward the seat limit
    role_value = role.value if isinstance(role, UserRole) else role
    if role_value == UserRole.EMPLOYEE.value:
        return

    current_count = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.role.in_([UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN])
    ).count()
    grace = limits.get("grace_users", 0)
    hard_limit = max_users + grace
    if current_count + additional > hard_limit:
        plan_label = limits["label"]
        if grace > 0:
            extra_price = limits.get("price_per_extra_seat", 0)
            raise HTTPException(
                status_code=403,
                detail=f"Seat limit reached. The {plan_label} plan supports up to {hard_limit} agent/admin seats ({max_users} included + up to {grace} extra at ${extra_price}/seat/month). For more than {hard_limit} seats, please contact us about Enterprise pricing. Employees can still be added freely."
            )
        else:
            raise HTTPException(
                status_code=403,
                detail=f"Agent/Admin seat limit reached for the {plan_label} plan ({max_users} seat{'s' if max_users != 1 else ''}). Employees can still be added freely. Upgrade your plan for more agent/admin seats."
            )

# =============================================================================
# ENUMS
# =============================================================================

class UserRole(str, enum.Enum):
    EMPLOYEE = "employee"
    AGENT = "agent"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"  # platform owner — sees/manages all tenants

class TicketStatus(str, enum.Enum):
    PENDING_APPROVAL = "pending_approval"
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"

class TicketPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class TicketType(str, enum.Enum):
    INCIDENT = "incident"
    SERVICE_REQUEST = "service_request"

class AssetType(str, enum.Enum):
    HARDWARE = "hardware"
    SOFTWARE = "software"

class AssetStatus(str, enum.Enum):
    AVAILABLE = "available"
    ASSIGNED = "assigned"
    MAINTENANCE = "maintenance"
    RETIRED = "retired"

class ChangeRisk(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class ChangeStatus(str, enum.Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    IMPLEMENTED = "implemented"

class Permission(str, enum.Enum):
    VIEW_ALL_TICKETS = "view_all_tickets"
    CREATE_TICKETS = "create_tickets"
    EDIT_TICKETS = "edit_tickets"
    DELETE_TICKETS = "delete_tickets"
    MANAGE_ASSETS = "manage_assets"
    MANAGE_USERS = "manage_users"
    MANAGE_KB = "manage_kb"
    VIEW_REPORTS = "view_reports"
    MANAGE_CANNED = "manage_canned"
    CREATE_CHANGES = "create_changes"
    APPROVE_CHANGES = "approve_changes"
    MANAGE_CATALOG = "manage_catalog"
    MANAGE_TENANT = "manage_tenant"

# =============================================================================
# MODELS
# =============================================================================

class CustomRole(Base):
    __tablename__ = "custom_roles"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    permissions = Column(Text, nullable=False)  # JSON list of Permission values
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())

    tenant = relationship("Tenant", back_populates="custom_roles")

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    logo_url = Column(String, nullable=True)
    primary_color = Column(String, default="#4f46e5")
    accent_color = Column(String, default="#818cf8")
    company_tagline = Column(String, nullable=True)
    support_email = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    plan = Column(String, default="free")  # free | pro | enterprise
    # Billing (Paddle)
    paddle_customer_id = Column(String, nullable=True)
    paddle_subscription_id = Column(String, nullable=True)
    billing_status = Column(String, nullable=True)  # active | past_due | canceled | paused
    plan_renews_at = Column(DateTime, nullable=True)
    # Security settings
    mfa_enabled = Column(Boolean, default=False)       # MFA available for voluntary enrollment
    mfa_required = Column(Boolean, default=False)      # MFA mandatory for all users
    sso_enabled = Column(Boolean, default=False)
    sso_provider = Column(String, default="google")
    sso_client_id = Column(String, nullable=True)
    sso_client_secret = Column(String, nullable=True)
    sso_domain = Column(String, nullable=True)
    sso_tenant_id = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())

    users = relationship("User", back_populates="tenant")
    tickets = relationship("Ticket", back_populates="tenant")
    assets = relationship("Asset", back_populates="tenant")
    kb_articles = relationship("KBArticle", back_populates="tenant")
    change_requests = relationship("ChangeRequest", back_populates="tenant")
    service_catalog_items = relationship("ServiceCatalogItem", back_populates="tenant")
    custom_roles = relationship("CustomRole", back_populates="tenant")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.EMPLOYEE)
    custom_role_id = Column(Integer, ForeignKey("custom_roles.id"), nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    language = Column(String, default='en')
    theme = Column(String, default='light')
    profile_photo = Column(String, nullable=True)
    job_title = Column(String, nullable=True)
    department = Column(String, nullable=True)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    status_changed_at = Column(DateTime, nullable=True)  # last time is_active was toggled
    current_session_id = Column(String, nullable=True)  # for single-session enforcement
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String, nullable=True)
    mfa_backup_codes = Column(Text, nullable=True)  # JSON array of unused backup codes
    email_verified = Column(Boolean, default=False)  # must verify email before tenant is activated
    created_at = Column(DateTime, server_default=sa_func.now())

    tenant = relationship("Tenant", back_populates="users")
    custom_role = relationship("CustomRole")

class SignupVerification(Base):
    """Stores pending email verification tokens for self-serve signup."""
    __tablename__ = "signup_verifications"
    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plan = Column(String, default="free")  # plan they signed up for (determines post-verify redirect)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())


class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    ticket_type = Column(SAEnum(TicketType), default=TicketType.INCIDENT)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    category = Column(String, nullable=True)
    priority = Column(SAEnum(TicketPriority), default=TicketPriority.MEDIUM)
    status = Column(SAEnum(TicketStatus), default=TicketStatus.OPEN)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    sla_response_deadline = Column(DateTime, nullable=True)
    sla_resolution_deadline = Column(DateTime, nullable=True)
    sla_breach_notified_at = Column(DateTime, nullable=True)  # last SLA breach notification sent
    escalated_at = Column(DateTime, nullable=True)             # last escalation timestamp
    csat_token = Column(String, unique=True, nullable=True)
    csat_rating = Column(Integer, nullable=True)
    csat_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="tickets")
    requester = relationship("User", foreign_keys=[requester_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    asset = relationship("Asset", back_populates="tickets", foreign_keys=[asset_id])
    comments = relationship("Comment", back_populates="ticket", order_by="Comment.created_at")
    attachments = relationship("Attachment", back_populates="ticket", order_by="Attachment.uploaded_at")

class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(String, nullable=False)
    is_internal = Column(Boolean, default=False)  # True = agent-only private note, not visible to requester
    created_at = Column(DateTime, server_default=sa_func.now())

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User")

class KBArticle(Base):
    __tablename__ = "kb_articles"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="kb_articles")
    author = relationship("User")

class Asset(Base):
    __tablename__ = "assets"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    type = Column(SAEnum(AssetType), nullable=False)
    serial_number = Column(String, unique=True, nullable=True)
    status = Column(SAEnum(AssetStatus), default=AssetStatus.AVAILABLE)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    purchase_date = Column(DateTime, nullable=True)
    license_key = Column(String, nullable=True)
    vendor = Column(String, nullable=True)
    expiry_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="assets")
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    tickets = relationship("Ticket", back_populates="asset", foreign_keys=[Ticket.asset_id])

class CannedResponse(Base):
    __tablename__ = "canned_responses"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    author = relationship("User")

class Attachment(Base):
    __tablename__ = "attachments"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, server_default=sa_func.now())

    ticket = relationship("Ticket", back_populates="attachments")

class ChangeRequest(Base):
    __tablename__ = "change_requests"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    risk_level = Column(SAEnum(ChangeRisk), default=ChangeRisk.MEDIUM)
    status = Column(SAEnum(ChangeStatus), default=ChangeStatus.PENDING_APPROVAL)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    planned_date = Column(Date, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="change_requests")
    requester = relationship("User", foreign_keys=[requester_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])

class ServiceCatalogItem(Base):
    __tablename__ = "service_catalog_items"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)
    estimated_cost = Column(Float, nullable=True)
    delivery_time_days = Column(Integer, nullable=True)
    approval_required = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    # Pre-fill fields (merged from TicketTemplate)
    ticket_title = Column(String, nullable=True)
    ticket_description = Column(Text, nullable=True)
    ticket_type = Column(String, default="service_request")
    priority = Column(String, default="medium")
    is_onboarding = Column(Boolean, default=False)      # triggers bulk ticket creation
    onboarding_tasks = Column(Text, nullable=True)       # JSON array of tasks
    is_featured = Column(Boolean, default=False)        # shown under Quick Start
    created_at = Column(DateTime, server_default=sa_func.now())

    tenant = relationship("Tenant", back_populates="service_catalog_items")

class EmailConfig(Base):
    __tablename__ = "email_configs"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)
    smtp_host = Column(String, default="")
    smtp_port = Column(Integer, default=587)
    smtp_user = Column(String, default="")
    smtp_pass = Column(String, default="")
    smtp_from = Column(String, default="noreply@itsm.local")
    slack_webhook_url = Column(String, default="")
    teams_webhook_url = Column(String, default="")
    updated_at = Column(DateTime, onupdate=sa_func.now())

class EscalationRule(Base):
    __tablename__ = "escalation_rules"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    priority = Column(String, nullable=True)        # if None, applies to all priorities
    idle_hours = Column(Integer, nullable=False)    # hours without update before escalating
    escalate_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # specific agent
    escalate_to_role = Column(String, nullable=True)  # or any agent/admin
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=sa_func.now())

class SLAConfig(Base):
    __tablename__ = "sla_configs"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)
    low_response = Column(Integer, default=8)
    low_resolution = Column(Integer, default=72)
    medium_response = Column(Integer, default=4)
    medium_resolution = Column(Integer, default=48)
    high_response = Column(Integer, default=2)
    high_resolution = Column(Integer, default=24)
    critical_response = Column(Integer, default=1)
    critical_resolution = Column(Integer, default=8)
    updated_at = Column(DateTime, onupdate=sa_func.now())

class BusinessHoursConfig(Base):
    __tablename__ = "business_hours_configs"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)
    enabled = Column(Boolean, default=False)
    start_hour = Column(Integer, default=9)   # 9 AM
    end_hour = Column(Integer, default=17)    # 5 PM
    # Working days: comma-separated 0=Mon,1=Tue,...,6=Sun
    working_days = Column(String, default="0,1,2,3,4")  # Mon-Fri
    timezone = Column(String, default="UTC")
    updated_at = Column(DateTime, onupdate=sa_func.now())

# ── AI Chatbot models (Enterprise plan) ──────────────────────────────────

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    title      = Column(String, default="New conversation")
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, server_default=sa_func.now(), onupdate=sa_func.now())
    messages   = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    role       = Column(String, nullable=False)   # "user" | "assistant"
    content    = Column(Text, nullable=False)
    tool_calls = Column(Text, nullable=True)       # JSON summary of tools used
    created_at = Column(DateTime, server_default=sa_func.now())
    session    = relationship("ChatSession", back_populates="messages")

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(String, nullable=False)
    link = Column(String, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())

class SystemAuditLog(Base):
    """Platform-wide audit log for admin actions: user management, settings, plan changes, etc."""
    __tablename__ = "system_audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_email = Column(String, nullable=True)  # stored in case user is later deleted
    action = Column(String, nullable=False)       # e.g. "user.created", "plan.changed", "branding.updated"
    target_type = Column(String, nullable=True)   # e.g. "user", "tenant", "workflow"
    target_id = Column(String, nullable=True)     # ID of the affected object
    target_label = Column(String, nullable=True)  # human-readable e.g. "jane@acme.com"
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())


class TicketAuditLog(Base):
    __tablename__ = "ticket_audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)
    field = Column(String, nullable=True)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())

class ApprovalWorkflow(Base):
    __tablename__ = "approval_workflows"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)       # matches ticket category e.g. "Hardware"
    ticket_type = Column(String, default="service_request")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    steps = relationship("ApprovalStep", back_populates="workflow", order_by="ApprovalStep.step_order")

class ApprovalStep(Base):
    __tablename__ = "approval_steps"
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("approval_workflows.id"), nullable=False)
    step_order = Column(Integer, nullable=False)   # 1, 2, 3...
    name = Column(String, nullable=False)          # e.g. "Line Manager Approval"
    approver_id = Column(Integer, ForeignKey("users.id"), nullable=True)   # specific user
    approver_role = Column(String, nullable=True)  # or any user with this role
    workflow = relationship("ApprovalWorkflow", back_populates="steps")

class TicketApproval(Base):
    __tablename__ = "ticket_approvals"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    workflow_id = Column(Integer, ForeignKey("approval_workflows.id"), nullable=False)
    step_id = Column(Integer, ForeignKey("approval_steps.id"), nullable=False)
    step_order = Column(Integer, nullable=False)
    step_name = Column(String, nullable=False)
    approver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approver_role = Column(String, nullable=True)
    status = Column(String, default="pending")     # pending, approved, rejected, skipped
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())

# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class TicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: TicketPriority = TicketPriority.MEDIUM
    ticket_type: TicketType = TicketType.INCIDENT
    on_behalf_of_id: int | None = None  # agents/admins can log on behalf of another user

class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    assigned_to_id: int | None = None
    priority: TicketPriority | None = None
    category: str | None = None
    title: str | None = None
    description: str | None = None

class TicketOut(BaseModel):
    id: int
    ticket_type: TicketType = TicketType.INCIDENT
    title: str
    description: str
    category: str | None
    priority: TicketPriority
    status: TicketStatus
    requester_id: int
    requester_name: str = ""
    assigned_to_id: int | None
    asset_id: int | None = None
    sla_response_deadline: datetime | None = None
    sla_resolution_deadline: datetime | None = None
    sla_status: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True

class CommentCreate(BaseModel):
    body: str
    is_internal: bool = False  # True = private note visible only to agents/admins

class CommentOut(BaseModel):
    id: int
    ticket_id: int
    author_id: int
    author_name: str
    body: str
    is_internal: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

class KBArticleCreate(BaseModel):
    title: str
    content: str
    category: str | None = None

class KBArticleUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None

class KBArticleOut(BaseModel):
    id: int
    title: str
    content: str
    category: str | None
    author_id: int
    author_name: str
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True

class AssetCreate(BaseModel):
    name: str
    type: AssetType
    serial_number: str | None = None
    status: AssetStatus = AssetStatus.AVAILABLE
    assigned_to_id: int | None = None
    purchase_date: datetime | None = None
    license_key: str | None = None
    vendor: str | None = None
    expiry_date: date | None = None
    notes: str | None = None

class AssetUpdate(BaseModel):
    name: str | None = None
    type: AssetType | None = None
    serial_number: str | None = None
    status: AssetStatus | None = None
    assigned_to_id: int | None = None
    purchase_date: datetime | None = None
    license_key: str | None = None
    vendor: str | None = None
    expiry_date: date | None = None
    notes: str | None = None

class AssetOut(BaseModel):
    id: int
    name: str
    type: AssetType
    serial_number: str | None
    status: AssetStatus
    assigned_to_id: int | None
    assigned_to_name: str | None = None
    purchase_date: datetime | None
    license_key: str | None = None
    vendor: str | None = None
    expiry_date: date | None = None
    notes: str | None
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True

class LinkAssetRequest(BaseModel):
    asset_id: int | None = None

class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    language: str = "en"
    theme: str = "light"
    profile_photo: str | None = None
    job_title: str | None = None
    department: str | None = None
    tenant_id: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True

class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    role: UserRole = UserRole.EMPLOYEE
    job_title: str | None = None
    department: str | None = None
    tenant_id: int | None = None

class SignupRequest(BaseModel):
    company_name: str
    full_name: str
    email: str
    password: str
    plan: str = "free"  # "free" or "pro" — Enterprise is not self-serve

class UserUpdate(BaseModel):
    email: str | None = None
    full_name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None
    job_title: str | None = None
    department: str | None = None
    tenant_id: int | None = None

class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    language: str | None = None
    theme: str | None = None
    job_title: str | None = None
    department: str | None = None

class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str

class CannedResponseCreate(BaseModel):
    title: str
    content: str
    category: str | None = None

class CannedResponseUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None

class CannedResponseOut(BaseModel):
    id: int
    title: str
    content: str
    category: str | None
    author_id: int
    author_name: str
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True

class AttachmentOut(BaseModel):
    id: int
    ticket_id: int
    filename: str
    content_type: str | None
    size: int
    uploaded_at: datetime

    class Config:
        from_attributes = True

class EmailTicketRequest(BaseModel):
    from_email: str
    subject: str
    body: str

class ChangeCreate(BaseModel):
    title: str
    description: str
    risk_level: ChangeRisk = ChangeRisk.MEDIUM
    planned_date: date | None = None

class ChangeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    risk_level: ChangeRisk | None = None
    planned_date: date | None = None

class ChangeOut(BaseModel):
    id: int
    title: str
    description: str
    risk_level: ChangeRisk
    status: ChangeStatus
    requester_id: int
    requester_name: str = ""
    assigned_to_id: int | None
    planned_date: date | None
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True

# ---------- New schemas ----------

class TenantOut(BaseModel):
    id: int
    name: str
    slug: str
    logo_url: str | None
    primary_color: str
    accent_color: str = "#818cf8"
    company_tagline: str | None = None
    support_email: str | None = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class ServiceCatalogItemCreate(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    estimated_cost: float | None = None
    delivery_time_days: int | None = None
    approval_required: bool = True
    is_active: bool = True
    is_featured: bool = False

class ServiceCatalogItemOut(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: str | None
    category: str | None
    estimated_cost: float | None
    delivery_time_days: int | None
    approval_required: bool
    is_active: bool
    is_featured: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

class CustomRoleCreate(BaseModel):
    name: str
    permissions: list[Permission]

class CustomRoleOut(BaseModel):
    id: int
    tenant_id: int
    name: str
    permissions: str
    is_default: bool
    created_at: datetime

    class Config:
        from_attributes = True

# CSAT schemas
class CSATSubmit(BaseModel):
    rating: int
    comment: str | None = None

class CSATStats(BaseModel):
    average: float | None
    count: int
    distribution: dict

# =============================================================================
# AUTH UTILITIES
# =============================================================================

# Password hashing uses the bcrypt library directly (not passlib), because
# passlib 1.7.x's bcrypt backend self-test ("detect_wrap_bug") is broken on
# bcrypt>=4.x / Python 3.14, raising on the very first hash/verify call.
import bcrypt as _bcrypt_lib

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set")

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
EMAIL_API_KEY = os.getenv("EMAIL_API_KEY", "dev-email-key")

MAX_FAILED_ATTEMPTS = int(os.getenv("MAX_FAILED_ATTEMPTS", "5"))
LOCKOUT_DURATION_MINUTES = int(os.getenv("LOCKOUT_DURATION_MINUTES", "15"))

# In-memory rate limiter
from collections import defaultdict
import time as _time

_login_ip_attempts = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "5"))

def check_ip_rate_limit(ip: str) -> bool:
    now = _time.time()
    _login_ip_attempts[ip] = [t for t in _login_ip_attempts[ip] if now - t < RATE_LIMIT_WINDOW]
    if len(_login_ip_attempts[ip]) >= RATE_LIMIT_MAX:
        return False
    _login_ip_attempts[ip].append(now)
    return True


PASSWORD_MIN_LENGTH = int(os.getenv("PASSWORD_MIN_LENGTH", "8"))

def validate_password_strength(password: str):
    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one digit")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise HTTPException(status_code=400, detail="Password must contain at least one special character")

def verify_password(plain, hashed):
    if not hashed:
        return False
    plain_bytes = plain.encode("utf-8")[:72]  # bcrypt max input length
    try:
        return _bcrypt_lib.checkpw(plain_bytes, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False

def get_password_hash(password):
    password_bytes = password.encode("utf-8")[:72]  # bcrypt max input length
    return _bcrypt_lib.hashpw(password_bytes, _bcrypt_lib.gensalt()).decode("utf-8")

# =============================================================================
# TOTP (RFC 6238) — implemented with stdlib only, no extra dependencies
# =============================================================================
import secrets as _secrets

def generate_totp_secret() -> str:
    """Generate a base32 secret for TOTP enrollment (16 chars = 80 bits)."""
    return base64.b32encode(_secrets.token_bytes(10)).decode("utf-8")

def _totp_code(secret: str, for_time: int, digits: int = 6, period: int = 30) -> str:
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    counter = int(for_time // period)
    msg = struct.pack(">Q", counter)
    h = hmac_lib.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = (struct.unpack(">I", h[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)

def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a TOTP code, allowing +/- `window` periods for clock drift."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    now = int(_time_module.time())
    for offset in range(-window, window + 1):
        if _totp_code(secret, now + offset * 30) == code:
            return True
    return False

def totp_provisioning_uri(secret: str, email: str, issuer: str = "DodoDesk") -> str:
    """Build the otpauth:// URI for QR code generation.
    Label is left unencoded here — the frontend applies encodeURIComponent once
    when embedding this whole URI into the QR code image URL."""
    label = f"{issuer}:{email}"
    params = urllib.parse.urlencode({"secret": secret, "issuer": issuer, "algorithm": "SHA1", "digits": 6, "period": 30})
    return f"otpauth://totp/{label}?{params}"

def generate_backup_codes(count: int = 8) -> list[str]:
    """Generate human-friendly backup codes like 'ABCD-1234'."""
    codes = []
    for _ in range(count):
        part1 = _secrets.token_hex(2).upper()
        part2 = _secrets.token_hex(2).upper()
        codes.append(f"{part1}-{part2}")
    return codes


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_access_token_with_expiry(data: dict, minutes: int):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str):
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

# =============================================================================
# EMAIL / NOTIFICATIONS
# =============================================================================

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@itsm.local")

# =============================================================================
# PADDLE BILLING CONFIG
# =============================================================================
PADDLE_API_KEY = os.getenv("PADDLE_API_KEY", "")
PADDLE_WEBHOOK_SECRET = os.getenv("PADDLE_WEBHOOK_SECRET", "")
PADDLE_ENV = os.getenv("PADDLE_ENV", "sandbox")  # "sandbox" or "production"
PADDLE_CLIENT_TOKEN = os.getenv("PADDLE_CLIENT_TOKEN", "")  # public, used by frontend checkout
PADDLE_PRICE_PRO_MONTHLY = os.getenv("PADDLE_PRICE_PRO_MONTHLY", "")
PADDLE_PRICE_PRO_ANNUAL = os.getenv("PADDLE_PRICE_PRO_ANNUAL", "")

# Anthropic AI chatbot (Enterprise plan)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = "claude-sonnet-4-6"

PADDLE_API_BASE = "https://sandbox-api.paddle.com" if PADDLE_ENV == "sandbox" else "https://api.paddle.com"

def get_email_config(db: Session, tenant_id: int) -> dict:
    """Get email config from DB, falling back to env vars."""
    cfg = db.query(EmailConfig).filter(EmailConfig.tenant_id == tenant_id).first()
    if cfg and cfg.smtp_host:
        return {
            "smtp_host": cfg.smtp_host, "smtp_port": cfg.smtp_port,
            "smtp_user": cfg.smtp_user, "smtp_pass": cfg.smtp_pass,
            "smtp_from": cfg.smtp_from,
            "slack_webhook_url": cfg.slack_webhook_url or "",
            "teams_webhook_url": cfg.teams_webhook_url or "",
        }
    return {
        "smtp_host": SMTP_HOST, "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER, "smtp_pass": SMTP_PASS,
        "smtp_from": SMTP_FROM,
        "slack_webhook_url": os.getenv("SLACK_WEBHOOK_URL", ""),
        "teams_webhook_url": os.getenv("TEAMS_WEBHOOK_URL", ""),
    }

def build_html_email(subject: str, body_text: str, company_name: str = "DodoDesk", primary_color: str = "#4f46e5", cta_url: str = None, cta_label: str = None) -> str:
    """Build a branded HTML email."""
    # Convert plain text body to HTML paragraphs
    paragraphs = ""
    for line in body_text.strip().split('\n'):
        line = line.strip()
        if line:
            paragraphs += f"<p style='margin:0 0 12px 0;color:#374151;font-size:15px;line-height:1.6;'>{line}</p>"

    cta_html = ""
    if cta_url and cta_label:
        cta_html = f"""
        <div style='text-align:center;margin:28px 0;'>
          <a href='{cta_url}' style='background:{primary_color};color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;'>
            {cta_label}
          </a>
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'>
  <table width='100%' cellpadding='0' cellspacing='0' style='background:#f3f4f6;padding:40px 20px;'>
    <tr><td align='center'>
      <table width='600' cellpadding='0' cellspacing='0' style='max-width:600px;width:100%;'>
        <!-- Header -->
        <tr>
          <td style='background:{primary_color};border-radius:12px 12px 0 0;padding:28px 36px;'>
            <h1 style='margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;'>{company_name}</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style='background:#ffffff;padding:36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;'>
            <h2 style='margin:0 0 20px 0;color:#111827;font-size:20px;font-weight:600;'>{subject}</h2>
            {paragraphs}
            {cta_html}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style='background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;'>
            <p style='margin:0;color:#9ca3af;font-size:12px;'>This email was sent by {company_name} via DodoDesk.</p>
            <p style='margin:6px 0 0 0;color:#9ca3af;font-size:12px;'>If you did not expect this email, please ignore it.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

def send_email(to: str, subject: str, body: str, cfg: dict = None, cta_url: str = None, cta_label: str = None, db=None):
    """Send branded HTML email using provided config dict or fall back to env vars."""
    host = (cfg or {}).get("smtp_host") or SMTP_HOST
    port = (cfg or {}).get("smtp_port") or SMTP_PORT
    user = (cfg or {}).get("smtp_user") or SMTP_USER
    password = (cfg or {}).get("smtp_pass") or SMTP_PASS
    from_addr = (cfg or {}).get("smtp_from") or SMTP_FROM

    # Get tenant branding for email
    company_name = "DodoDesk"
    primary_color = "#4f46e5"
    if db:
        try:
            tenant = db.query(Tenant).first()
            if tenant:
                company_name = tenant.name or company_name
                primary_color = tenant.primary_color or primary_color
        except: pass

    if not host:
        print(f"\n--- Email (no SMTP configured) ---")
        print(f"To: {to}\nSubject: {subject}\nBody:\n{body}\n")
        return

    # Build HTML version
    html_body = build_html_email(subject, body, company_name, primary_color, cta_url, cta_label)

    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    # Plain text fallback
    msg.attach(MIMEText(body, "plain"))
    # HTML version
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(host, int(port)) as server:
            server.starttls()
            if user:
                server.login(user, password)
            server.send_message(msg)
    except Exception as e:
        print(f"Failed to send email: {e}")

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

def send_notification(message: str, cfg: dict = None):
    """Send notification to Slack and/or Teams webhooks.
    Slack expects: {"text": "..."}
    Teams expects: {"type": "message", "attachments": [...]} (Adaptive Card) or legacy {"text": "..."}
    We send the correct format for each.
    """
    slack_url = (cfg or {}).get("slack_webhook_url") or SLACK_WEBHOOK_URL
    teams_url = (cfg or {}).get("teams_webhook_url") or TEAMS_WEBHOOK_URL

    slack_payload = json.dumps({"text": message}).encode("utf-8")

    # Teams Adaptive Card format (works with modern Teams webhooks)
    teams_payload = json.dumps({
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.2",
                "body": [{
                    "type": "TextBlock",
                    "text": message,
                    "wrap": True,
                    "size": "Small"
                }]
            }
        }]
    }).encode("utf-8")

    tasks = [
        (slack_url, "Slack", slack_payload),
        (teams_url, "Teams", teams_payload),
    ]
    for url, name, payload in tasks:
        if not url:
            continue
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status not in (200, 202, 204):
                    print(f"⚠ {name} notification failed: {resp.status}")
                else:
                    print(f"✅ {name} notification sent")
        except Exception as e:
            print(f"❌ Failed to send {name} notification: {e}")

def trigger_approval_workflow(db: Session, ticket: "Ticket"):
    """
    Check if an approval workflow matches this ticket's category/type.
    If yes, create TicketApproval records and notify the first approver.
    """
    workflow = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.tenant_id == ticket.tenant_id,
        ApprovalWorkflow.is_active == True,
        ApprovalWorkflow.ticket_type == ticket.ticket_type.value,
    ).filter(
        (ApprovalWorkflow.category == None) |
        (ApprovalWorkflow.category == ticket.category)
    ).first()

    if not workflow or not workflow.steps:
        return None

    # Create approval records for each step
    for step in workflow.steps:
        approval = TicketApproval(
            ticket_id=ticket.id,
            workflow_id=workflow.id,
            step_id=step.id,
            step_order=step.step_order,
            step_name=step.name,
            approver_id=step.approver_id,
            approver_role=step.approver_role,
            status="pending" if step.step_order == 1 else "waiting",
        )
        db.add(approval)
    db.flush()

    # Notify first approver
    first_step = workflow.steps[0]
    if first_step.approver_id:
        create_notification(db, first_step.approver_id, ticket.tenant_id,
            "approval_required",
            f"✅ Approval required: {ticket.title}",
            f'Step 1 of {len(workflow.steps)}: {first_step.name}',
            f"/tickets/{ticket.id}")
    elif first_step.approver_role:
        approvers = db.query(User).filter(
            User.tenant_id == ticket.tenant_id,
            User.role == first_step.approver_role,
            User.is_active == True
        ).all()
        for approver in approvers:
            create_notification(db, approver.id, ticket.tenant_id,
                "approval_required",
                f"✅ Approval required: {ticket.title}",
                f'Step 1 of {len(workflow.steps)}: {first_step.name}',
                f"/tickets/{ticket.id}")
    return workflow

def create_notification(db: Session, user_id: int, tenant_id: int, type: str, title: str, body: str, link: str = None):
    """Create an in-app notification for a user."""
    notif = Notification(user_id=user_id, tenant_id=tenant_id, type=type, title=title, body=body, link=link)
    db.add(notif)
    db.commit()

def log_ticket_event(db: Session, ticket_id: int, tenant_id: int, actor_id: int,
                     action: str, field: str = None, old_value: str = None,
                     new_value: str = None, note: str = None):
    """Append an audit log entry for a ticket."""
    entry = TicketAuditLog(
        ticket_id=ticket_id, tenant_id=tenant_id, actor_id=actor_id,
        action=action, field=field, old_value=old_value, new_value=new_value, note=note
    )
    db.add(entry)
    # Don't commit here — caller commits

def log_system_event(db: Session, actor: "User", action: str,
                     target_type: str = None, target_id: str = None,
                     target_label: str = None, old_value: str = None,
                     new_value: str = None, ip_address: str = None):
    """Append a system-level audit log entry (user management, settings, plan changes, etc.)."""
    entry = SystemAuditLog(
        tenant_id=actor.tenant_id if actor else None,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        target_label=target_label,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
        ip_address=ip_address,
    )
    db.add(entry)
    # Don't commit here — caller commits

# =============================================================================
# SLA RULES
# =============================================================================

SLA_RULES = {
    "low":      {"response": 8,  "resolution": 72},
    "medium":   {"response": 4,  "resolution": 48},
    "high":     {"response": 2,  "resolution": 24},
    "critical": {"response": 1,  "resolution": 8},
}

def get_sla_rules(db: Session, tenant_id: int) -> dict:
    """Get SLA rules from DB, falling back to hardcoded defaults."""
    cfg = db.query(SLAConfig).filter(SLAConfig.tenant_id == tenant_id).first()
    if cfg:
        return {
            "low":      {"response": cfg.low_response,      "resolution": cfg.low_resolution},
            "medium":   {"response": cfg.medium_response,   "resolution": cfg.medium_resolution},
            "high":     {"response": cfg.high_response,     "resolution": cfg.high_resolution},
            "critical": {"response": cfg.critical_response, "resolution": cfg.critical_resolution},
        }
    return SLA_RULES

def get_business_hours_config(db: Session, tenant_id: int) -> dict:
    """Get business hours config for a tenant."""
    cfg = db.query(BusinessHoursConfig).filter(BusinessHoursConfig.tenant_id == tenant_id).first()
    if cfg and cfg.enabled:
        return {
            "enabled": True,
            "start_hour": cfg.start_hour,
            "end_hour": cfg.end_hour,
            "working_days": [int(d) for d in cfg.working_days.split(",")],
        }
    return {"enabled": False}

def add_business_hours(start: datetime, hours: int, bh: dict) -> datetime:
    """
    Add `hours` of business time to `start`, skipping non-business hours and weekends.
    bh = {"start_hour": 9, "end_hour": 17, "working_days": [0,1,2,3,4]}
    """
    if not bh.get("enabled"):
        return start + timedelta(hours=hours)

    start_h = bh["start_hour"]
    end_h = bh["end_hour"]
    working_days = bh["working_days"]
    hours_per_day = end_h - start_h
    current = start
    remaining = hours

    # If starting outside business hours, advance to next business start
    def next_business_start(dt):
        # If before start of day
        if dt.weekday() not in working_days:
            dt = dt.replace(hour=start_h, minute=0, second=0, microsecond=0)
            dt += timedelta(days=1)
            while dt.weekday() not in working_days:
                dt += timedelta(days=1)
            return dt
        if dt.hour < start_h:
            return dt.replace(hour=start_h, minute=0, second=0, microsecond=0)
        if dt.hour >= end_h:
            dt = dt.replace(hour=start_h, minute=0, second=0, microsecond=0) + timedelta(days=1)
            while dt.weekday() not in working_days:
                dt += timedelta(days=1)
            return dt
        return dt

    current = next_business_start(current)

    while remaining > 0:
        # Hours left in current business day
        day_end = current.replace(hour=end_h, minute=0, second=0, microsecond=0)
        hours_today = (day_end - current).total_seconds() / 3600

        if remaining <= hours_today:
            current += timedelta(hours=remaining)
            remaining = 0
        else:
            remaining -= hours_today
            # Move to next business day start
            current = current.replace(hour=start_h, minute=0, second=0, microsecond=0) + timedelta(days=1)
            while current.weekday() not in working_days:
                current += timedelta(days=1)

    return current

def compute_sla_deadlines(priority: str, created_at: datetime, db: Session = None, tenant_id: int = None):
    if db and tenant_id:
        rules = get_sla_rules(db, tenant_id).get(priority, {"response": 4, "resolution": 48})
        bh = get_business_hours_config(db, tenant_id)
    else:
        rules = SLA_RULES.get(priority, {"response": 4, "resolution": 48})
        bh = {"enabled": False}

    response_deadline = add_business_hours(created_at, rules["response"], bh)
    resolution_deadline = add_business_hours(created_at, rules["resolution"], bh)
    return response_deadline, resolution_deadline

def compute_sla_status(ticket: Ticket) -> str:
    if ticket.status in [TicketStatus.RESOLVED, TicketStatus.CLOSED]:
        return "ok"
    now = datetime.utcnow()
    if ticket.sla_resolution_deadline and now > ticket.sla_resolution_deadline:
        return "overdue"
    if ticket.sla_response_deadline and now > ticket.sla_response_deadline:
        return "warning"
    return "ok"

# =============================================================================
# SEED FUNCTION
# =============================================================================

def seed():
    db = SessionLocal()
    # Skip seeding if ANY users exist — database is already set up
    if db.query(User).count() > 0:
        print("✅ Database already seeded — skipping.")
        db.close()
        return
    # Skip if tenant exists with custom logo or color
    existing_tenant = db.query(Tenant).first()
    if existing_tenant and (existing_tenant.logo_url or existing_tenant.primary_color != "#4f46e5"):
        print("✅ Tenant already customised — skipping seed.")
        db.close()
        return

    # Default tenant — only create if doesn't exist
    existing = db.query(Tenant).filter(Tenant.slug == "default").first()
    if not existing:
        tenant = Tenant(name="My Company", slug="default", logo_url=None, primary_color="#4f46e5")
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        tenant_id = tenant.id
    else:
        tenant_id = existing.id

    # Custom roles
    if not db.query(CustomRole).first():
        admin_role = CustomRole(tenant_id=tenant_id, name="Admin",
                                permissions=json.dumps([p.value for p in Permission]),
                                is_default=True)
        agent_role = CustomRole(tenant_id=tenant_id, name="Agent",
                                permissions=json.dumps([
                                    Permission.VIEW_ALL_TICKETS.value,
                                    Permission.EDIT_TICKETS.value,
                                    Permission.MANAGE_KB.value,
                                    Permission.VIEW_REPORTS.value,
                                    Permission.MANAGE_CANNED.value,
                                    Permission.CREATE_CHANGES.value,
                                    Permission.APPROVE_CHANGES.value,
                                    Permission.MANAGE_ASSETS.value
                                ]))
        readonly_agent_role = CustomRole(tenant_id=tenant_id, name="Read‑only Agent",
                                         permissions=json.dumps([
                                             Permission.VIEW_ALL_TICKETS.value,
                                             Permission.VIEW_REPORTS.value
                                         ]))
        db.add_all([admin_role, agent_role, readonly_agent_role])
        db.commit()
        db.refresh(admin_role)
        db.refresh(agent_role)
        db.refresh(readonly_agent_role)
        admin_role_id = admin_role.id
        agent_role_id = agent_role.id
        readonly_agent_role_id = readonly_agent_role.id
    else:
        roles = db.query(CustomRole).all()
        admin_role_id = next((r.id for r in roles if r.name == "Admin"), None)
        agent_role_id = next((r.id for r in roles if r.name == "Agent"), None)

    # Users
    # Users — only create if they don't exist, never update existing
    seed_admin_email = os.getenv("SEED_ADMIN_EMAIL", "admin@example.com")
    seed_admin_pass  = os.getenv("SEED_ADMIN_PASSWORD", "Admin1234")
    seed_agent_email = os.getenv("SEED_AGENT_EMAIL", "agent@example.com")
    seed_agent_pass  = os.getenv("SEED_AGENT_PASSWORD", "Agent1234")
    seed_emp_email   = os.getenv("SEED_EMPLOYEE_EMAIL", "employee@example.com")
    seed_emp_pass    = os.getenv("SEED_EMPLOYEE_PASSWORD", "Emp1234")

    if not db.query(User).filter(User.email == seed_admin_email).first():
        db.add(User(email=seed_admin_email,
                    hashed_password=get_password_hash(seed_admin_pass),
                    full_name="Admin User",
                    role=UserRole.ADMIN,
                    custom_role_id=admin_role_id,
                    tenant_id=tenant_id))
    if not db.query(User).filter(User.email == seed_emp_email).first():
        db.add(User(email=seed_emp_email,
                    hashed_password=get_password_hash(seed_emp_pass),
                    full_name="Alice Employee",
                    role=UserRole.EMPLOYEE,
                    tenant_id=tenant_id))
    if not db.query(User).filter(User.email == seed_agent_email).first():
        db.add(User(email=seed_agent_email,
                    hashed_password=get_password_hash(seed_agent_pass),
                    full_name="Bob Agent",
                    role=UserRole.AGENT,
                    custom_role_id=agent_role_id,
                    tenant_id=tenant_id))
    # KB
    if not db.query(KBArticle).first():
        db.add(KBArticle(title="How to reset your password",
                         content="1. Go to the login page.\n2. Click 'Forgot password'.\n3. Follow the instructions sent to your email.",
                         category="Account", author_id=2, tenant_id=tenant_id))
        db.add(KBArticle(title="Printer troubleshooting",
                         content="If the printer is offline:\n- Check the power cable.\n- Restart the printer.\n- Ensure it's connected to the network.",
                         category="Hardware", author_id=2, tenant_id=tenant_id))
    # Assets
    if not db.query(Asset).first():
        db.add(Asset(name="Dell Laptop #1", type=AssetType.HARDWARE, serial_number="SN-001",
                     status=AssetStatus.AVAILABLE, notes="15 inch, i7", tenant_id=tenant_id))
        db.add(Asset(name="Microsoft Office License", type=AssetType.SOFTWARE, serial_number="LIC-001",
                     status=AssetStatus.ASSIGNED, assigned_to_id=1,
                     license_key="XXXX-XXXX-XXXX", vendor="Microsoft",
                     expiry_date=date.today() + timedelta(days=10), tenant_id=tenant_id))
    # Tickets
    if not db.query(Ticket).first():
        now = datetime.utcnow()
        created_incident = now - timedelta(hours=3)
        resp, reso = compute_sla_deadlines("high", created_incident)
        db.add(Ticket(ticket_type=TicketType.INCIDENT, title="VPN connection issue",
                     description="Unable to connect to VPN from home office.",
                     category="Network", priority=TicketPriority.HIGH,
                     status=TicketStatus.OPEN, requester_id=1,
                     sla_response_deadline=resp, sla_resolution_deadline=reso,
                     created_at=created_incident, tenant_id=tenant_id))
        created_request = now - timedelta(days=1)
        resp2, reso2 = compute_sla_deadlines("medium", created_request)
        db.add(Ticket(ticket_type=TicketType.SERVICE_REQUEST,
                     title="New laptop request",
                     description="I need a developer-grade laptop with 32GB RAM.",
                     category="Hardware", priority=TicketPriority.MEDIUM,
                     status=TicketStatus.PENDING_APPROVAL, requester_id=1,
                     sla_response_deadline=resp2, sla_resolution_deadline=reso2,
                     created_at=created_request, tenant_id=tenant_id))
    # Canned
    if not db.query(CannedResponse).first():
        db.add(CannedResponse(title="Printer offline check",
                              content="Please restart the printer by turning it off and on again.",
                              category="Hardware", author_id=2))
        db.add(CannedResponse(title="Password reset instructions",
                              content="Please visit the forgot password page.",
                              category="Account", author_id=2))
    # Change
    if not db.query(ChangeRequest).first():
        db.add(ChangeRequest(title="Server maintenance reboot",
                             description="Planned reboot of the application server.",
                             risk_level=ChangeRisk.MEDIUM,
                             status=ChangeStatus.PENDING_APPROVAL,
                             requester_id=1,
                             planned_date=date.today() + timedelta(days=3),
                             tenant_id=tenant_id))
    # Service catalog items
    if not db.query(ServiceCatalogItem).first():
        db.add(ServiceCatalogItem(tenant_id=tenant_id, name="New Laptop",
                                  description="Standard developer laptop (16GB RAM, 512GB SSD)",
                                  category="Hardware", estimated_cost=1500.0,
                                  delivery_time_days=5, approval_required=True))
        db.add(ServiceCatalogItem(tenant_id=tenant_id, name="VPN Access",
                                  description="VPN access for remote workers",
                                  category="Software", approval_required=False))
    db.commit()
    db.close()
    print("Seed data created (if not already present).")

# =============================================================================
# FASTAPI APP & LIFESPAN
# =============================================================================

UPLOAD_DIR = "uploads"
AVATAR_DIR = os.path.join(UPLOAD_DIR, "avatars")

def check_sla_breaches():
    """
    Runs every 5 minutes. Finds tickets that:
    - Are open or in_progress
    - Have breached their resolution deadline
    - Haven't been notified in the last 4 hours (to avoid spam)
    Sends in-app notification + email + Slack/Teams to assigned agent.
    """
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        notify_cooldown = now - timedelta(hours=4)

        breached = db.query(Ticket).filter(
            Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS]),
            Ticket.sla_resolution_deadline < now,
            (Ticket.sla_breach_notified_at == None) |
            (Ticket.sla_breach_notified_at < notify_cooldown)
        ).all()

        for ticket in breached:
            # Get email config for this tenant
            cfg = get_email_config(db, ticket.tenant_id)

            # Notify assigned agent (if any)
            if ticket.assigned_to_id:
                agent = db.query(User).filter(User.id == ticket.assigned_to_id).first()
                if agent:
                    create_notification(db, agent.id, ticket.tenant_id,
                        "sla_breach",
                        f"⚠ SLA Breached — {ticket.title}",
                        f"Ticket #{ticket.id} has exceeded its resolution SLA. Immediate attention required.",
                        f"/tickets/{ticket.id}")
                    send_email(agent.email,
                        f"⚠ SLA Breach: Ticket #{ticket.id} — {ticket.title}",
                        f"Hi {agent.full_name},\n\n"
                        f"Ticket #{ticket.id} \"{ticket.title}\" has breached its SLA resolution deadline.\n"
                        f"Priority: {ticket.priority.value}\n"
                        f"Deadline was: {ticket.sla_resolution_deadline.strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                        f"Please action this ticket immediately.\n\n"
                        f"View: {FRONTEND_URL}/tickets/{ticket.id}",
                        cfg)

            # Also notify all admins in the tenant
            admins = db.query(User).filter(
                User.tenant_id == ticket.tenant_id,
                User.role == UserRole.ADMIN,
                User.is_active == True
            ).all()
            for admin in admins:
                create_notification(db, admin.id, ticket.tenant_id,
                    "sla_breach",
                    f"⚠ SLA Breached — {ticket.title}",
                    f"Ticket #{ticket.id} has exceeded its resolution SLA.",
                    f"/tickets/{ticket.id}")

            # Slack/Teams alert
            send_notification(
                f"⚠ *SLA Breach*: Ticket #{ticket.id} \"{ticket.title}\" "
                f"(Priority: {ticket.priority.value}) has exceeded its resolution deadline. "
                f"Assigned to: {ticket.assigned_to.full_name if ticket.assigned_to_id else 'Unassigned'}",
                cfg
            )

            # Mark as notified
            ticket.sla_breach_notified_at = now
            db.commit()

        if breached:
            print(f"✅ SLA breach check: notified {len(breached)} ticket(s)")

    except Exception as e:
        print(f"❌ SLA breach check error: {e}")
    finally:
        db.close()

def check_escalations():
    """
    Runs every 10 minutes. Finds open/in-progress tickets that have been
    idle (no updates) for longer than the escalation rule threshold,
    and reassigns/notifies accordingly.
    """
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        rules = db.query(EscalationRule).filter(EscalationRule.is_active == True).all()

        for rule in rules:
            idle_cutoff = now - timedelta(hours=rule.idle_hours)
            escalation_cooldown = now - timedelta(hours=rule.idle_hours)

            query = db.query(Ticket).filter(
                Ticket.tenant_id == rule.tenant_id,
                Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS]),
                Ticket.updated_at < idle_cutoff,
                (Ticket.escalated_at == None) | (Ticket.escalated_at < escalation_cooldown)
            )
            if rule.priority:
                query = query.filter(Ticket.priority == TicketPriority(rule.priority))

            tickets = query.all()

            for ticket in tickets:
                old_assignee_id = ticket.assigned_to_id
                new_assignee = None

                # Escalate to specific agent
                if rule.escalate_to_id:
                    new_assignee = db.query(User).filter(User.id == rule.escalate_to_id).first()

                # Escalate to any available agent/admin (least loaded)
                elif rule.escalate_to_role:
                    new_assignee = db.query(User).filter(
                        User.tenant_id == rule.tenant_id,
                        User.role == rule.escalate_to_role,
                        User.is_active == True,
                        User.id != old_assignee_id
                    ).first()

                if new_assignee:
                    ticket.assigned_to_id = new_assignee.id
                    ticket.escalated_at = now
                    log_ticket_event(db, ticket.id, ticket.tenant_id, new_assignee.id,
                                     action="assigned",
                                     field="assigned_to",
                                     old_value=db.query(User).filter(User.id == old_assignee_id).first().full_name if old_assignee_id else "Unassigned",
                                     new_value=new_assignee.full_name,
                                     note=f"Auto-escalated by rule: {rule.name}")

                    # Notify new assignee
                    create_notification(db, new_assignee.id, ticket.tenant_id,
                        "ticket_assigned",
                        f"🔺 Escalated to you: Ticket #{ticket.id}",
                        f'"{ticket.title}" has been escalated to you after {rule.idle_hours}h of inactivity.',
                        f"/tickets/{ticket.id}")

                    # Email new assignee
                    cfg = get_email_config(db, ticket.tenant_id)
                    send_email(new_assignee.email,
                        f"🔺 Escalated Ticket #{ticket.id}: {ticket.title}",
                        f"Hi {new_assignee.full_name},\n\n"
                        f"Ticket #{ticket.id} \"{ticket.title}\" has been escalated to you "
                        f"after {rule.idle_hours} hours of inactivity.\n\n"
                        f"Priority: {ticket.priority.value}\n"
                        f"View: {FRONTEND_URL}/tickets/{ticket.id}",
                        cfg)

                    db.commit()
                    print(f"✅ Escalated ticket #{ticket.id} to {new_assignee.full_name} (rule: {rule.name})")

    except Exception as e:
        print(f"❌ Escalation check error: {e}")
    finally:
        db.close()

def run_migrations():
    """Add any missing columns to existing tables (lightweight migration for SQLite/PostgreSQL)."""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)

    # Add new enum value to PostgreSQL userrole enum type if missing (no-op on SQLite)
    # Note: SQLAlchemy's SAEnum stores the Python enum NAME (e.g. 'SUPER_ADMIN'), not .value
    if not SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
        for enum_name in ("userrole", "UserRole"):
            for value in ("SUPER_ADMIN", "super_admin"):
                try:
                    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                        conn.execute(text(f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS '{value}'"))
                        print(f"✅ Migration: ensured '{value}' exists in {enum_name} enum")
                except Exception as e:
                    print(f"⚠️ Migration skipped for {enum_name}.{value}: {e}")

    try:
        existing_columns = {col['name'] for col in inspector.get_columns('users')}
    except Exception:
        return  # table doesn't exist yet — create_all will handle it

    migrations = {
        'status_changed_at': 'TIMESTAMP',
        'current_session_id': 'VARCHAR',
        'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
        'mfa_secret': 'VARCHAR',
        'mfa_backup_codes': 'TEXT',
        'email_verified': 'BOOLEAN DEFAULT FALSE',
    }

    with engine.connect() as conn:
        for col_name, col_type in migrations.items():
            if col_name not in existing_columns:
                try:
                    conn.execute(text(f'ALTER TABLE users ADD COLUMN {col_name} {col_type}'))
                    conn.commit()
                    print(f"✅ Migration: added column users.{col_name}")
                except Exception as e:
                    print(f"⚠️ Migration skipped for users.{col_name}: {e}")

    # Create signup_verifications table if it doesn't exist
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS signup_verifications (
                    id SERIAL PRIMARY KEY,
                    token VARCHAR UNIQUE NOT NULL,
                    email VARCHAR NOT NULL,
                    tenant_id INTEGER REFERENCES tenants(id),
                    user_id INTEGER REFERENCES users(id),
                    plan VARCHAR DEFAULT 'free',
                    expires_at TIMESTAMP NOT NULL,
                    used BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: signup_verifications table ready")
    except Exception as e:
        print(f"⚠️ Migration: signup_verifications: {e}")

    # System audit log table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS system_audit_logs (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER REFERENCES tenants(id),
                    actor_id INTEGER REFERENCES users(id),
                    actor_email VARCHAR,
                    action VARCHAR NOT NULL,
                    target_type VARCHAR,
                    target_id VARCHAR,
                    target_label VARCHAR,
                    old_value VARCHAR,
                    new_value VARCHAR,
                    ip_address VARCHAR,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: system_audit_logs table ready")
    except Exception as e:
        print(f"⚠️ Migration: system_audit_logs: {e}")

    # Comments — is_internal (private notes)
    try:
        comment_columns = {col['name'] for col in inspector.get_columns('comments')}
        if 'is_internal' not in comment_columns:
            with engine.connect() as conn:
                conn.execute(text('ALTER TABLE comments ADD COLUMN is_internal BOOLEAN DEFAULT FALSE'))
                conn.commit()
                print("✅ Migration: added column comments.is_internal")
    except Exception as e:
        print(f"⚠️ Migration: comments.is_internal: {e}")

    # AI chatbot tables
    try:
        existing_tables = inspector.get_table_names()
        if "chat_sessions" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""CREATE TABLE chat_sessions (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    user_id   INTEGER NOT NULL REFERENCES users(id),
                    title     VARCHAR DEFAULT 'New conversation',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )"""))
                conn.commit()
                print("✅ Migration: chat_sessions table created")
        if "chat_messages" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""CREATE TABLE chat_messages (
                    id         SERIAL PRIMARY KEY,
                    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role       VARCHAR NOT NULL,
                    content    TEXT    NOT NULL,
                    tool_calls TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )"""))
                conn.commit()
                print("✅ Migration: chat_messages table created")
    except Exception as e:
        print(f"⚠️ Migration: chat tables: {e}")

    # Service catalog items — is_featured
    try:
        sc_columns = {col['name'] for col in inspector.get_columns('service_catalog_items')}
        if 'is_featured' not in sc_columns:
            with engine.connect() as conn:
                conn.execute(text('ALTER TABLE service_catalog_items ADD COLUMN is_featured BOOLEAN DEFAULT FALSE'))
                conn.commit()
                print("✅ Migration: added column service_catalog_items.is_featured")
    except Exception as e:
        print(f"⚠️ Migration skipped for service_catalog_items.is_featured: {e}")

    # Tenants — security config columns
    try:
        tenant_columns = {col['name'] for col in inspector.get_columns('tenants')}
        tenant_migrations = {
            'plan': "VARCHAR DEFAULT 'free'",
            'paddle_customer_id': 'VARCHAR',
            'paddle_subscription_id': 'VARCHAR',
            'billing_status': 'VARCHAR',
            'plan_renews_at': 'TIMESTAMP',
            'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
            'mfa_required': 'BOOLEAN DEFAULT FALSE',
            'sso_enabled': 'BOOLEAN DEFAULT FALSE',
            'sso_provider': "VARCHAR DEFAULT 'google'",
            'sso_client_id': 'VARCHAR',
            'sso_client_secret': 'VARCHAR',
            'sso_domain': 'VARCHAR',
            'sso_tenant_id': 'VARCHAR',
        }
        with engine.connect() as conn:
            for col_name, col_type in tenant_migrations.items():
                if col_name not in tenant_columns:
                    try:
                        conn.execute(text(f'ALTER TABLE tenants ADD COLUMN {col_name} {col_type}'))
                        conn.commit()
                        print(f"✅ Migration: added column tenants.{col_name}")
                    except Exception as e:
                        print(f"⚠️ Migration skipped for tenants.{col_name}: {e}")
    except Exception as e:
        print(f"⚠️ Tenant migration check failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(AVATAR_DIR, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    run_migrations()
    seed()

    # Start SLA breach notification scheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_sla_breaches, 'interval', minutes=5, id='sla_breach_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=30))
    scheduler.add_job(check_escalations, 'interval', minutes=10, id='escalation_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=60))
    scheduler.start()
    print("✅ SLA breach + escalation schedulers started")

    yield

    scheduler.shutdown()
    print("SLA breach scheduler stopped")

app = FastAPI(lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# DEPENDENCIES
# =============================================================================

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        email = payload.get("sub")
        session_id = payload.get("sid")
        if email is None or payload.get("mfa_pending"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is disabled")
    # Single-session enforcement: reject if a newer login has invalidated this session
    if session_id and user.current_session_id and session_id != user.current_session_id:
        raise HTTPException(status_code=401, detail="You have been logged out because your account was signed in from another device or browser.")
    return user

def get_current_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="Only admins can perform this action")
    return current_user

def has_permission(user: User, permission: Permission) -> bool:
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return True
    if user.custom_role:
        permissions = json.loads(user.custom_role.permissions)
        return permission.value in permissions
    # Legacy fallback
    if user.role == UserRole.AGENT:
        return permission in [
            Permission.VIEW_ALL_TICKETS,
            Permission.EDIT_TICKETS,
            Permission.CREATE_TICKETS,
            Permission.MANAGE_ASSETS,
            Permission.MANAGE_KB,
            Permission.VIEW_REPORTS,
            Permission.MANAGE_CANNED,
            Permission.CREATE_CHANGES,
            Permission.APPROVE_CHANGES
        ]
    if user.role == UserRole.EMPLOYEE:
        return permission in [
            Permission.CREATE_TICKETS,
            Permission.CREATE_CHANGES
        ]
    return False

def apply_filters(query, ticket_type: str | None, start_date: date | None, end_date: date | None):
    if ticket_type and ticket_type != 'change':
        try:
            ttype = TicketType(ticket_type)
            query = query.filter(Ticket.ticket_type == ttype)
        except ValueError:
            pass
    if start_date:
        query = query.filter(Ticket.created_at >= datetime(start_date.year, start_date.month, start_date.day))
    if end_date:
        end_dt = datetime(end_date.year, end_date.month, end_date.day) + timedelta(days=1)
        query = query.filter(Ticket.created_at < end_dt)
    return query

# =============================================================================
# ENDPOINTS
# =============================================================================

# ---------- Authentication ----------
@app.post("/auth/forgot-password")
def forgot_password(data: dict, db: Session = Depends(get_db)):
    email = data.get("email", "").lower().strip()
    user = db.query(User).filter(User.email == email, User.is_active == True).first()
    if not user:
        # Don't reveal if email exists
        return {"ok": True, "message": "If that email exists, a reset link has been sent."}
    # Generate reset token
    token = uuid.uuid4().hex
    user.csat_token = f"reset_{token}"  # reuse csat_token field for reset token
    db.commit()
    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
    send_email(
        user.email,
        "🔑 Password Reset",
        f"Hi {user.full_name},\n\n"
        f"You requested a password reset. Click the button below to set a new password.\n\n"
        f"This link expires in 1 hour. If you did not request this, you can safely ignore this email.",
        cta_url=reset_url,
        cta_label="Reset My Password",
        db=db
    )
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}

@app.post("/auth/reset-password")
def reset_password(data: dict, db: Session = Depends(get_db)):
    token = data.get("token", "")
    new_password = data.get("new_password", "")
    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")
    user = db.query(User).filter(User.csat_token == f"reset_{token}").first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    validate_password(new_password)
    user.hashed_password = get_password_hash(new_password[:72])
    user.csat_token = None  # invalidate token
    db.commit()
    return {"ok": True, "message": "Password reset successfully. You can now log in."}

# =============================================================================
# SELF-SERVE SIGNUP
# =============================================================================

def slugify_company_name(name: str) -> str:
    """Convert a company name into a URL-safe slug, e.g. 'Acme Corp!' -> 'acme-corp'."""
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "company"

def generate_unique_slug(db: Session, base_slug: str) -> str:
    """Append a numeric suffix if the slug is already taken."""
    slug = base_slug
    suffix = 1
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        suffix += 1
        slug = f"{base_slug}-{suffix}"
    return slug

@app.get("/signup/verify")
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

# =============================================================================
# SELF-SERVE SIGNUP
# =============================================================================

def slugify(name: str) -> str:
    """Convert company name to a URL-safe slug: 'Acme Corp' -> 'acme-corp'."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_-]+', '-', slug)
    slug = slug.strip('-')
    return slug or "tenant"

def unique_slug(db: Session, base: str) -> str:
    """Append a number if the slug is already taken: 'acme-corp', 'acme-corp-2', etc."""
    slug = base[:40]  # keep reasonable length
    existing = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not existing:
        return slug
    counter = 2
    while True:
        candidate = f"{slug[:37]}-{counter}"
        if not db.query(Tenant).filter(Tenant.slug == candidate).first():
            return candidate
        counter += 1

def generate_verification_token() -> str:
    return secrets.token_urlsafe(32)

@app.post("/auth/signup")
@limiter.limit("5/hour")
def signup(request: Request, data: dict, db: Session = Depends(get_db)):
    """Self-serve signup: creates an inactive tenant + admin user, sends verification email.
    Body: { company_name, full_name, email, password, plan }
    Plan is 'free' or 'pro' — Enterprise requires contact.
    Tenant and user are inactive until email is verified.
    """
    company_name = (data.get("company_name") or "").strip()
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()
    plan = (data.get("plan") or "free").strip().lower()

    # Basic validation
    if not company_name or not full_name or not email or not password:
        raise HTTPException(status_code=400, detail="All fields are required.")
    if plan not in ("free", "pro"):
        plan = "free"

    # Check email not already registered
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in or use a different email.")

    # Validate password strength
    validate_password_strength(password)

    # Generate unique slug
    base_slug = slugify(company_name)
    slug = unique_slug(db, base_slug)

    # Create tenant (inactive until email verified)
    tenant = Tenant(
        name=company_name,
        slug=slug,
        is_active=False,
        plan="free",  # always start on free — upgrade to pro happens after verify + checkout
    )
    db.add(tenant)
    db.flush()  # get tenant.id

    # Create admin user (inactive until verified)
    admin_user = User(
        tenant_id=tenant.id,
        email=email,
        hashed_password=get_password_hash(password),
        full_name=full_name,
        role=UserRole.ADMIN,
        is_active=False,
        email_verified=False,
    )
    db.add(admin_user)
    db.flush()

    # Create verification token (expires in 24 hours)
    token = generate_verification_token()
    verification = SignupVerification(
        token=token,
        email=email,
        tenant_id=tenant.id,
        user_id=admin_user.id,
        plan=plan,
        expires_at=datetime.utcnow() + timedelta(hours=24),
    )
    db.add(verification)
    db.commit()

    # Send verification email
    frontend_url = os.getenv("FRONTEND_URL", "https://dodo-desk-pied.vercel.app")
    verify_url = f"{frontend_url}/verify-email?token={token}"
    try:
        send_email(
            to=email,
            subject="Verify your DodoDesk account",
            body=f"Hi {full_name},\n\nWelcome to DodoDesk! Please verify your email address to activate your account for {company_name}.\n\nThis link expires in 24 hours.",
            cta_url=verify_url,
            cta_label="Verify Email",
        )
    except Exception as e:
        print(f"⚠️ Failed to send verification email: {e}")
        # Don't fail signup if email fails — they can request resend later

    return {
        "message": "Account created! Please check your email to verify your address before logging in.",
        "email": email,
    }


@app.get("/auth/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    """Verifies an email token and activates the tenant + admin user.
    Returns a short-lived access token so the frontend can log them in automatically,
    plus the plan they selected (so frontend can redirect to Paddle checkout if 'pro').
    """
    verification = db.query(SignupVerification).filter(
        SignupVerification.token == token,
        SignupVerification.used == False,
    ).first()

    if not verification:
        raise HTTPException(status_code=400, detail="Verification link is invalid or has already been used.")
    if verification.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Verification link has expired. Please sign up again.")

    # Activate tenant and user
    tenant = db.query(Tenant).filter(Tenant.id == verification.tenant_id).first()
    user = db.query(User).filter(User.id == verification.user_id).first()

    if not tenant or not user:
        raise HTTPException(status_code=400, detail="Account data not found. Please sign up again.")

    tenant.is_active = True
    user.is_active = True
    user.email_verified = True

    # Mark token used
    verification.used = True

    # Generate login session
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


@app.post("/auth/resend-verification")
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

    frontend_url = os.getenv("FRONTEND_URL", "https://dodo-desk-pied.vercel.app")
    verify_url = f"{frontend_url}/verify-email?token={token}"
    send_email(
        to=email,
        subject="Verify your DodoDesk account (new link)",
        body=f"Hi {user.full_name},\n\nHere's a new verification link for your DodoDesk account. The previous link has been invalidated.\n\nThis link expires in 24 hours.",
        cta_url=verify_url,
        cta_label="Verify Email",
    )

    return {"message": "If this email has a pending verification, a new link has been sent."}


@app.post("/auth/login")
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
            if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(days=3650)
                user.failed_login_attempts = 0
                db.commit()
                raise HTTPException(status_code=423, detail=f"Account locked after {MAX_FAILED_ATTEMPTS} failed attempts. Please contact your administrator.")
            db.commit()
            remaining = MAX_FAILED_ATTEMPTS - user.failed_login_attempts
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

    access_token = create_access_token(data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id})
    return {"access_token": access_token, "token_type": "bearer", "mfa_setup_required": mfa_setup_required}

@app.post("/auth/login/mfa")
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

    access_token = create_access_token(data={"sub": user.email, "tenant_id": user.tenant_id, "sid": session_id})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/")
def list_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all active users in the tenant. Accessible to agents and admins."""
    if current_user.role not in [UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    users = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.is_active == True
    ).all()
    return users

@app.get("/users/me", response_model=UserOut)
def read_users_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role.value,
        "is_active": current_user.is_active,
        "language": current_user.language or "en",
        "theme": current_user.theme or "light",
        "profile_photo": current_user.profile_photo,
        "created_at": current_user.created_at,
        "branding": {
            "company_name": tenant.name if tenant else "ITSM Portal",
            "company_tagline": tenant.company_tagline if tenant else None,
            "primary_color": tenant.primary_color if tenant else "#4f46e5",
            "accent_color": tenant.accent_color if tenant else "#818cf8",
            "logo_url": tenant.logo_url if tenant else None,
            "support_email": tenant.support_email if tenant else None,
        } if tenant else None,
    }

# ---------- Tickets (tenant‑scoped + permissions + QUICK FILTERS + CSAT) ----------
@app.post("/tickets/", response_model=TicketOut)
def create_ticket(ticket: TicketCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.CREATE_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if tenant:
        trial = get_trial_status(tenant)
        if trial["trial_expired"]:
            raise HTTPException(
                status_code=403,
                detail="Your 14-day free trial has ended. Please upgrade to the Pro plan to continue creating tickets."
            )

    # Determine requester — agents/admins can log on behalf of another user
    requester_id = current_user.id
    if ticket.on_behalf_of_id and has_permission(current_user, Permission.EDIT_TICKETS):
        behalf_user = db.query(User).filter(
            User.id == ticket.on_behalf_of_id,
            User.tenant_id == current_user.tenant_id
        ).first()
        if behalf_user:
            requester_id = behalf_user.id

    now = datetime.utcnow()
    initial_status = TicketStatus.PENDING_APPROVAL if ticket.ticket_type == TicketType.SERVICE_REQUEST else TicketStatus.OPEN
    resp, reso = compute_sla_deadlines(ticket.priority.value, now, db, current_user.tenant_id)
    db_ticket = Ticket(
        tenant_id=current_user.tenant_id,
        ticket_type=ticket.ticket_type,
        title=ticket.title,
        description=ticket.description,
        category=ticket.category,
        priority=ticket.priority,
        requester_id=requester_id,
        status=initial_status,
        sla_response_deadline=resp,
        sla_resolution_deadline=reso,
        created_at=now
    )
    db.add(db_ticket)
    db.commit()
    db.refresh(db_ticket)

    requester = db.query(User).filter(User.id == requester_id).first()
    on_behalf_note = f" (logged by {current_user.full_name} on behalf of {requester.full_name})" if requester_id != current_user.id else ""
    notif_cfg = get_email_config(db, current_user.tenant_id)
    send_notification(
        f"📩 New {ticket.ticket_type.value}: *{ticket.title}*\n"
        f"From: {requester.full_name if requester else current_user.full_name}{on_behalf_note}\n"
        f"Status: {initial_status.value}\n"
        f"View: {FRONTEND_URL}/tickets/{db_ticket.id}",
        notif_cfg
    )
    log_ticket_event(db, db_ticket.id, current_user.tenant_id, current_user.id,
                     action="created",
                     note=f'Ticket "{db_ticket.title}" created{on_behalf_note}.')
    # Trigger approval workflow if applicable
    if db_ticket.ticket_type == TicketType.SERVICE_REQUEST:
        trigger_approval_workflow(db, db_ticket)
    db.commit()

    # Send confirmation email to requester — wrapped to prevent email errors from breaking ticket creation
    try:
        if requester and requester.email:
            ticket_id_fmt = f"{'INC' if db_ticket.ticket_type == TicketType.INCIDENT else 'REQ'}{db_ticket.id:06d}"
            send_email(
                requester.email,
                f"✅ Ticket {ticket_id_fmt} created: {db_ticket.title}",
                f"Hi {requester.full_name},\n\n"
                f"Your ticket has been successfully created and our team will get back to you shortly.\n\n"
                f"Ticket: {ticket_id_fmt}\n"
                f"Title: {db_ticket.title}\n"
                f"Priority: {db_ticket.priority.value.capitalize()}\n"
                f"Status: {initial_status.value.replace('_', ' ').capitalize()}\n\n"
                f"Thank you.",
                cta_url=f"{FRONTEND_URL}/tickets/{db_ticket.id}",
                cta_label="View Your Ticket",
                db=db
            )
    except Exception as e:
        print(f"Email send failed (ticket still created): {e}")

    return _ticket_to_out(db_ticket)

@app.get("/tickets/")
def list_tickets(
    search: str | None = Query(None),
    assigned: str | None = Query(None, description="Filter by assignment: 'me', 'unassigned'"),
    status: str | None = Query(None, description="Filter by ticket status (e.g., 'open', 'overdue')"),
    priority: str | None = Query(None, description="Filter by priority: low, medium, high, critical"),
    category: str | None = Query(None, description="Filter by category"),
    ticket_type: str | None = Query(None, description="Filter by type: incident, service_request"),
    sort_by: str | None = Query(None, description="Sort by: created_at, priority, sla_resolution_deadline"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)

    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS):
        query = query.filter(Ticket.requester_id == current_user.id)

    if assigned == "me":
        query = query.filter(Ticket.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Ticket.assigned_to_id == None)

    if status:
        if status == "overdue":
            query = query.filter(
                Ticket.sla_resolution_deadline < datetime.utcnow(),
                Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS])
            )
        elif status == "open":
            query = query.filter(Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_APPROVAL]))
        else:
            try:
                st = TicketStatus(status)
                query = query.filter(Ticket.status == st)
            except ValueError:
                pass

    if priority:
        try:
            query = query.filter(Ticket.priority == TicketPriority(priority))
        except ValueError:
            pass

    if category:
        query = query.filter(Ticket.category.ilike(f"%{category}%"))

    if ticket_type:
        try:
            query = query.filter(Ticket.ticket_type == TicketType(ticket_type))
        except ValueError:
            pass

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
            (Ticket.priority == TicketPriority.CRITICAL, 0),
            (Ticket.priority == TicketPriority.HIGH, 1),
            (Ticket.priority == TicketPriority.MEDIUM, 2),
            (Ticket.priority == TicketPriority.LOW, 3),
            else_=4
        )
        query = query.order_by(priority_order, Ticket.created_at.desc())
    elif sort_by == "sla":
        query = query.order_by(Ticket.sla_resolution_deadline.asc().nullslast(), Ticket.created_at.desc())
    else:
        query = query.order_by(Ticket.created_at.desc())

    tickets = query.offset(skip).limit(limit).all()
    return {"items": [_ticket_to_out(t) for t in tickets], "total": total, "skip": skip, "limit": limit}

@app.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _ticket_to_out(ticket)

@app.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, update: TicketUpdate,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    update_data = update.model_dump(exclude_unset=True)
    old_status = ticket.status.value if ticket.status else None
    old_assigned = ticket.assigned_to_id
    if "status" in update_data:
        new_status = update_data["status"]
        ticket.status = new_status
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="status_changed", field="status",
                         old_value=old_status,
                         new_value=new_status.value if hasattr(new_status, 'value') else str(new_status))
        # --- CSAT trigger ---
        if update_data["status"] == TicketStatus.RESOLVED and not ticket.csat_token:
            ticket.csat_token = uuid.uuid4().hex
            requester = db.query(User).filter(User.id == ticket.requester_id).first()
            if requester:
                survey_url = f"{FRONTEND_URL}/csat/{ticket.csat_token}"
                send_email(
                    requester.email,
                    f"✅ Ticket resolved: {ticket.title}",
                    f"Hi {requester.full_name},\n\nYour ticket \"{ticket.title}\" has been resolved.\n"
                    f"Please rate our service: {survey_url}\n\nThank you!"
                )
        # --- Status change emails for other statuses ---
        elif update_data["status"] in [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED]:
            requester = db.query(User).filter(User.id == ticket.requester_id).first()
            if requester and requester.id != current_user.id:
                status_label = {
                    TicketStatus.IN_PROGRESS: "🔄 In Progress",
                    TicketStatus.CLOSED: "🔒 Closed",
                }.get(update_data["status"], str(update_data["status"]))
                ticket_id_fmt = f"{'INC' if ticket.ticket_type == TicketType.INCIDENT else 'REQ'}{ticket.id:06d}"
                send_email(
                    requester.email,
                    f"Ticket {ticket_id_fmt} status updated: {status_label}",
                    f"Hi {requester.full_name},\n\n"
                    f"The status of your ticket has been updated.\n\n"
                    f"Ticket: {ticket_id_fmt}\n"
                    f"Title: {ticket.title}\n"
                    f"New Status: {status_label}\n\n"
                    f"View your ticket: {FRONTEND_URL}/tickets/{ticket.id}\n\n"
                    f"Thank you."
                )
        # --- end CSAT ---
    if "assigned_to_id" in update_data:
        new_assigned = update_data["assigned_to_id"]
        ticket.assigned_to_id = new_assigned
        old_name = db.query(User).filter(User.id == old_assigned).first()
        new_name = db.query(User).filter(User.id == new_assigned).first()
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="assigned", field="assigned_to",
                         old_value=old_name.full_name if old_name else "Unassigned",
                         new_value=new_name.full_name if new_name else "Unassigned")
    if "priority" in update_data:
        old_priority = ticket.priority.value if ticket.priority else None
        new_priority = update_data["priority"]
        ticket.priority = new_priority
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="priority_changed", field="priority",
                         old_value=old_priority,
                         new_value=new_priority.value if hasattr(new_priority, 'value') else str(new_priority))
    if "category" in update_data and update_data["category"]:
        old_category = ticket.category
        ticket.category = update_data["category"]
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="category_changed", field="category",
                         old_value=old_category, new_value=update_data["category"])
    if "title" in update_data and update_data["title"]:
        old_title = ticket.title
        ticket.title = update_data["title"]
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="title_changed", field="title",
                         old_value=old_title, new_value=update_data["title"])
    if "description" in update_data and update_data["description"]:
        ticket.description = update_data["description"]
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="description_updated", field="description")
    db.commit()
    db.refresh(ticket)
    return _ticket_to_out(ticket)

@app.patch("/tickets/{ticket_id}/link-asset", response_model=TicketOut)
def link_asset(ticket_id: int, link: LinkAssetRequest,
               current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ticket.asset_id = link.asset_id
    db.commit()
    db.refresh(ticket)
    return _ticket_to_out(ticket)

def _ticket_to_out(ticket: Ticket) -> dict:
    requester = ticket.requester
    return {
        "id": ticket.id,
        "ticket_type": ticket.ticket_type,
        "title": ticket.title,
        "description": ticket.description,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "requester_id": ticket.requester_id,
        "requester_name": requester.full_name if requester else "Unknown",
        "assigned_to_id": ticket.assigned_to_id,
        "asset_id": ticket.asset_id,
        "sla_response_deadline": ticket.sla_response_deadline,
        "sla_resolution_deadline": ticket.sla_resolution_deadline,
        "sla_status": compute_sla_status(ticket),
        "created_at": ticket.created_at,
    }

@app.post("/tickets/{ticket_id}/reopen", response_model=TicketOut)
def reopen_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Re-open a resolved or closed ticket. Agents/admins only."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status not in [TicketStatus.RESOLVED, TicketStatus.CLOSED]:
        raise HTTPException(status_code=400, detail="Only resolved or closed tickets can be reopened.")
    old_status = ticket.status.value
    ticket.status = TicketStatus.OPEN
    ticket.csat_token = None  # Reset CSAT so it can be re-sent on next resolution
    log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                     action="status_changed", field="status",
                     old_value=old_status, new_value="open")
    db.commit()
    db.refresh(ticket)
    # Notify requester
    requester = db.query(User).filter(User.id == ticket.requester_id).first()
    if requester and requester.id != current_user.id:
        send_email(
            requester.email,
            f"Ticket reopened: {ticket.title}",
            f"Hi {requester.full_name},\n\nYour ticket \"{ticket.title}\" has been reopened and is being worked on again.\n\nView: {FRONTEND_URL}/tickets/{ticket.id}"
        )
    return _ticket_to_out(ticket)

# ---------- Approval workflow ----------
@app.post("/tickets/{ticket_id}/approve", response_model=TicketOut)
def approve_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status != TicketStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Ticket is not in pending approval status")
    ticket.status = TicketStatus.OPEN
    log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                     action="approved", field="status",
                     old_value="pending_approval", new_value="open")
    db.commit()
    db.refresh(ticket)
    requester = db.query(User).filter(User.id == ticket.requester_id).first()
    if requester:
        send_email(requester.email,
                   f"Your request has been approved: #{ticket.id} {ticket.title}",
                   f"Your service request has been approved and is now being processed.\n\nView: {FRONTEND_URL}/tickets/{ticket.id}")
    return _ticket_to_out(ticket)

@app.post("/tickets/{ticket_id}/reject", response_model=TicketOut)
def reject_ticket(ticket_id: int, comment: CommentCreate,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.status != TicketStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Ticket is not in pending approval status")
    ticket.status = TicketStatus.CLOSED
    db_comment = Comment(ticket_id=ticket_id, author_id=current_user.id, body=comment.body)
    db.add(db_comment)
    log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                     action="rejected", field="status",
                     old_value="pending_approval", new_value="closed",
                     note=comment.body)
    db.commit()
    db.refresh(ticket)
    requester = db.query(User).filter(User.id == ticket.requester_id).first()
    if requester:
        send_email(requester.email,
                   f"Your request has been rejected: #{ticket.id} {ticket.title}",
                   f"Your service request has been rejected.\nReason: {comment.body}\n\nView: {FRONTEND_URL}/tickets/{ticket.id}")
    return _ticket_to_out(ticket)

# ---------- Comments ----------
@app.post("/tickets/{ticket_id}/comments", response_model=CommentOut)
def add_comment(ticket_id: int, comment: CommentCreate,
                current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.EDIT_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Only agents/admins can post internal notes
    is_internal = comment.is_internal and has_permission(current_user, Permission.EDIT_TICKETS)

    db_comment = Comment(ticket_id=ticket_id, author_id=current_user.id, body=comment.body, is_internal=is_internal)
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                     action="internal_note_added" if is_internal else "comment_added",
                     note=f'{comment.body[:120]}{"..." if len(comment.body) > 120 else ""}')
    db.commit()

    # Don't send email/notification for internal notes — they're agent-only
    if not is_internal:
        if current_user.role in [UserRole.AGENT, UserRole.ADMIN] and ticket.requester_id != current_user.id:
            requester = db.query(User).filter(User.id == ticket.requester_id).first()
            if requester:
                send_email(requester.email,
                           f"New reply on ticket #{ticket.id}: {ticket.title}",
                           f"Agent {current_user.full_name} replied:\n\n{comment.body}\n\nView: {FRONTEND_URL}/tickets/{ticket.id}")
        comment_cfg = get_email_config(db, current_user.tenant_id)
        send_notification(
            f"💬 New comment on ticket #{ticket.id} *{ticket.title}*\n"
            f"By: {current_user.full_name}\n"
            f"Comment: {comment.body[:100]}{'...' if len(comment.body) > 100 else ''}\n"
            f"View: {FRONTEND_URL}/tickets/{ticket.id}",
            comment_cfg
        )
    return {"id": db_comment.id, "ticket_id": db_comment.ticket_id, "author_id": db_comment.author_id,
            "author_name": current_user.full_name, "body": db_comment.body,
            "is_internal": db_comment.is_internal, "created_at": db_comment.created_at}

@app.get("/tickets/{ticket_id}/comments", response_model=list[CommentOut])
def list_comments(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    comments = db.query(Comment).filter(Comment.ticket_id == ticket_id).all()
    is_agent_or_admin = has_permission(current_user, Permission.EDIT_TICKETS)
    result = []
    for c in comments:
        # Requesters (employees) cannot see internal notes
        if c.is_internal and not is_agent_or_admin:
            continue
        author = db.query(User).filter(User.id == c.author_id).first()
        result.append({"id": c.id, "ticket_id": c.ticket_id, "author_id": c.author_id,
                       "author_name": author.full_name if author else "Unknown",
                       "body": c.body, "is_internal": c.is_internal,
                       "created_at": c.created_at})
    return result

@app.get("/tickets/{ticket_id}/audit-log")
def get_audit_log(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

# ---------- Knowledge Base (tenant‑scoped) ----------
@app.get("/kb/articles/")
def search_kb_articles(search: str | None = Query(None), skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    query = db.query(KBArticle).filter(KBArticle.tenant_id == current_user.tenant_id)
    if search:
        term = f"%{search}%"
        query = query.filter(KBArticle.title.ilike(term) | KBArticle.content.ilike(term))
    total = query.count()
    articles = query.order_by(KBArticle.updated_at.desc()).offset(skip).limit(limit).all()
    result = []
    for art in articles:
        author = db.query(User).filter(User.id == art.author_id).first()
        result.append({"id": art.id, "title": art.title, "content": art.content, "category": art.category,
                       "author_id": art.author_id, "author_name": author.full_name if author else "Unknown",
                       "created_at": art.created_at, "updated_at": art.updated_at})
    return {"items": result, "total": total, "skip": skip, "limit": limit}

@app.get("/kb/articles/{article_id}", response_model=KBArticleOut)
def get_kb_article(article_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    author = db.query(User).filter(User.id == article.author_id).first()
    return {"id": article.id, "title": article.title, "content": article.content, "category": article.category,
            "author_id": article.author_id, "author_name": author.full_name if author else "Unknown",
            "created_at": article.created_at, "updated_at": article.updated_at}

@app.post("/kb/articles/", response_model=KBArticleOut)
def create_kb_article(article: KBArticleCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = KBArticle(
        tenant_id=current_user.tenant_id,
        title=article.title, content=article.content, category=article.category, author_id=current_user.id
    )
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return {"id": db_article.id, "title": db_article.title, "content": db_article.content, "category": db_article.category,
            "author_id": db_article.author_id, "author_name": current_user.full_name,
            "created_at": db_article.created_at, "updated_at": db_article.updated_at}

@app.put("/kb/articles/{article_id}", response_model=KBArticleOut)
def update_kb_article(article_id: int, article: KBArticleUpdate,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")
    update_data = article.model_dump(exclude_unset=True)
    for field in ["title", "content", "category"]:
        if field in update_data:
            setattr(db_article, field, update_data[field])
    db.commit()
    db.refresh(db_article)
    author = db.query(User).filter(User.id == db_article.author_id).first()
    return {"id": db_article.id, "title": db_article.title, "content": db_article.content, "category": db_article.category,
            "author_id": db_article.author_id, "author_name": author.full_name if author else "Unknown",
            "created_at": db_article.created_at, "updated_at": db_article.updated_at}

@app.delete("/kb/articles/{article_id}")
def delete_kb_article(article_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_article = db.query(KBArticle).filter(KBArticle.id == article_id, KBArticle.tenant_id == current_user.tenant_id).first()
    if not db_article:
        raise HTTPException(status_code=404, detail="Article not found")
    db.delete(db_article)
    db.commit()
    return {"detail": "Article deleted"}

# ---------- Asset Management (tenant‑scoped + permissions) ----------
@app.get("/assets/")
def list_assets(search: str | None = Query(None), skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    query = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id)
    if search:
        term = f"%{search}%"
        query = query.filter(Asset.name.ilike(term) | Asset.serial_number.ilike(term))
    total = query.count()
    assets = query.order_by(Asset.name).offset(skip).limit(limit).all()
    result = []
    for a in assets:
        assigned = db.query(User).filter(User.id == a.assigned_to_id).first()
        result.append({
            "id": a.id, "name": a.name, "type": a.type, "serial_number": a.serial_number,
            "status": a.status, "assigned_to_id": a.assigned_to_id,
            "assigned_to_name": assigned.full_name if assigned else None,
            "purchase_date": a.purchase_date,
            "license_key": a.license_key, "vendor": a.vendor, "expiry_date": a.expiry_date,
            "notes": a.notes,
            "created_at": a.created_at, "updated_at": a.updated_at
        })
    return {"items": result, "total": total, "skip": skip, "limit": limit}

@app.get("/assets/expiring", response_model=list[AssetOut])
def expiring_assets(days: int = Query(30), db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    today = date.today()
    deadline = today + timedelta(days=days)
    assets = db.query(Asset).filter(
        Asset.tenant_id == current_user.tenant_id,
        Asset.expiry_date.isnot(None),
        Asset.expiry_date > today,
        Asset.expiry_date <= deadline
    ).order_by(Asset.expiry_date).all()
    result = []
    for a in assets:
        assigned = db.query(User).filter(User.id == a.assigned_to_id).first()
        result.append({
            "id": a.id, "name": a.name, "type": a.type, "serial_number": a.serial_number,
            "status": a.status, "assigned_to_id": a.assigned_to_id,
            "assigned_to_name": assigned.full_name if assigned else None,
            "purchase_date": a.purchase_date,
            "license_key": a.license_key, "vendor": a.vendor, "expiry_date": a.expiry_date,
            "notes": a.notes,
            "created_at": a.created_at, "updated_at": a.updated_at
        })
    return result

@app.get("/assets/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    assigned = db.query(User).filter(User.id == asset.assigned_to_id).first()
    return {
        "id": asset.id, "name": asset.name, "type": asset.type, "serial_number": asset.serial_number,
        "status": asset.status, "assigned_to_id": asset.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": asset.purchase_date,
        "license_key": asset.license_key, "vendor": asset.vendor, "expiry_date": asset.expiry_date,
        "notes": asset.notes,
        "created_at": asset.created_at, "updated_at": asset.updated_at
    }

@app.post("/assets/", response_model=AssetOut)
def create_asset(asset: AssetCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_asset = Asset(tenant_id=current_user.tenant_id, **asset.dict())
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    assigned = db.query(User).filter(User.id == db_asset.assigned_to_id).first()
    return {
        "id": db_asset.id, "name": db_asset.name, "type": db_asset.type, "serial_number": db_asset.serial_number,
        "status": db_asset.status, "assigned_to_id": db_asset.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": db_asset.purchase_date,
        "license_key": db_asset.license_key, "vendor": db_asset.vendor, "expiry_date": db_asset.expiry_date,
        "notes": db_asset.notes,
        "created_at": db_asset.created_at, "updated_at": db_asset.updated_at
    }

@app.patch("/assets/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, asset_update: AssetUpdate,
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    update_data = asset_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_asset, field, value)
    db.commit()
    db.refresh(db_asset)
    assigned = db.query(User).filter(User.id == db_asset.assigned_to_id).first()
    return {
        "id": db_asset.id, "name": db_asset.name, "type": db_asset.type, "serial_number": db_asset.serial_number,
        "status": db_asset.status, "assigned_to_id": db_asset.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": db_asset.purchase_date,
        "license_key": db_asset.license_key, "vendor": db_asset.vendor, "expiry_date": db_asset.expiry_date,
        "notes": db_asset.notes,
        "created_at": db_asset.created_at, "updated_at": db_asset.updated_at
    }

@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_ASSETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == current_user.tenant_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(db_asset)
    db.commit()
    return {"detail": "Asset deleted"}

# =============================================================================
# ATTACHMENT ENDPOINTS
# =============================================================================

ALLOWED_EXTENSIONS = {".txt", ".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv", ".zip", ".pptx"}
MAX_FILE_SIZE = 10 * 1024 * 1024

@app.post("/tickets/{ticket_id}/attachments", response_model=AttachmentOut)
def upload_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.CREATE_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' is not allowed")
    file_content = file.file.read()
    if len(file_content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 10 MB limit")
    unique_name = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(file_path, "wb") as f:
        f.write(file_content)
    file_size = len(file_content)
    db_attachment = Attachment(
        ticket_id=ticket_id,
        filename=file.filename,
        stored_filename=unique_name,
        content_type=file.content_type,
        size=file_size
    )
    db.add(db_attachment)
    db.commit()
    db.refresh(db_attachment)
    return db_attachment

@app.get("/tickets/{ticket_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return db.query(Attachment).filter(Attachment.ticket_id == ticket_id).all()

@app.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: int, db: Session = Depends(get_db)):
    attachment = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_path = os.path.join(UPLOAD_DIR, attachment.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(file_path, media_type=attachment.content_type or "application/octet-stream",
                        filename=attachment.filename)

# =============================================================================
# REPORTING ENDPOINTS (tenant‑scoped, permissions)
# =============================================================================

@app.get("/reports/summary")
def report_summary(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    base_query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
    base_query = apply_filters(base_query, ticket_type, start_date, end_date)
    total = base_query.count()
    open_count = base_query.filter(Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_APPROVAL])).count()
    overdue_count = base_query.filter(
        Ticket.sla_resolution_deadline < datetime.utcnow(),
        Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS])
    ).count()
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    resolved_today = base_query.filter(
        Ticket.status == TicketStatus.RESOLVED,
        Ticket.updated_at >= today_start
    ).count()
    avg_resolution_hours = 0
    try:
        resolved_tickets = base_query.filter(
            Ticket.status == TicketStatus.RESOLVED,
            Ticket.updated_at.isnot(None),
            Ticket.created_at.isnot(None)
        ).with_entities(Ticket.created_at, Ticket.updated_at).all()
        if resolved_tickets:
            total_hours = sum(
                (t.updated_at - t.created_at).total_seconds() / 3600
                for t in resolved_tickets
                if t.updated_at and t.created_at
            )
            avg_resolution_hours = round(total_hours / len(resolved_tickets), 1)
    except Exception:
        avg_resolution_hours = 0
    return {
        "total": total,
        "open": open_count,
        "overdue": overdue_count,
        "resolved_today": resolved_today,
        "avg_resolution_hours": avg_resolution_hours
    }

@app.get("/reports/sla-compliance")
def sla_compliance(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    base_query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
    base_query = apply_filters(base_query, ticket_type, start_date, end_date)
    resolved_total = base_query.filter(Ticket.status == TicketStatus.RESOLVED).count()
    if resolved_total == 0:
        return {"compliance_percent": 100.0, "total_resolved": 0}
    on_time = base_query.filter(
        Ticket.status == TicketStatus.RESOLVED,
        Ticket.updated_at <= Ticket.sla_resolution_deadline
    ).count()
    compliance = round((on_time / resolved_total) * 100, 1)
    return {"compliance_percent": compliance, "total_resolved": resolved_total, "on_time": on_time}

@app.get("/reports/tickets-by-priority")
def tickets_by_priority(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    query = db.query(Ticket.priority, sa_func.count(Ticket.id)).filter(Ticket.tenant_id == current_user.tenant_id)
    query = apply_filters(query, ticket_type, start_date, end_date)
    results = query.group_by(Ticket.priority).all()
    return [{"priority": p.value, "count": c} for p, c in results]

@app.get("/reports/tickets-by-status")
def tickets_by_status(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    query = db.query(Ticket.status, sa_func.count(Ticket.id)).filter(Ticket.tenant_id == current_user.tenant_id)
    query = apply_filters(query, ticket_type, start_date, end_date)
    results = query.group_by(Ticket.status).all()
    return [{"status": s.value, "count": c} for s, c in results]

@app.get("/reports/tickets-created-daily")
def tickets_created_daily(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if start_date and end_date:
        start = start_date
        end = end_date
    else:
        today = datetime.utcnow().date()
        start = today - timedelta(days=6)
        end = today
    days = []
    current = start
    while current <= end:
        day_start = datetime(current.year, current.month, current.day)
        day_end = day_start + timedelta(days=1)
        query = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            Ticket.created_at >= day_start,
            Ticket.created_at < day_end
        )
        query = apply_filters(query, ticket_type, None, None)
        count = query.count()
        days.append({"date": current.isoformat(), "count": count})
        current += timedelta(days=1)
    return days

@app.get("/reports/agent-workload")
def agent_workload(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    agents = db.query(User).filter(User.tenant_id == current_user.tenant_id, User.role == UserRole.AGENT).all()
    result = []
    for agent in agents:
        base = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            Ticket.assigned_to_id == agent.id
        )
        base = apply_filters(base, ticket_type, start_date, end_date)
        assigned = base.count()
        resolved = base.filter(Ticket.status == TicketStatus.RESOLVED).count()
        result.append({"agent_name": agent.full_name, "assigned": assigned, "resolved": resolved})
    return result

@app.get("/reports/export/csv")
def export_csv(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Type", "Title", "Category", "Priority", "Status", "Requester", "Assigned To", "Created", "SLA Status"])

    if ticket_type == "change":
        # Export change requests
        query = db.query(ChangeRequest).filter(ChangeRequest.tenant_id == current_user.tenant_id)
        if start_date:
            query = query.filter(ChangeRequest.created_at >= datetime(start_date.year, start_date.month, start_date.day))
        if end_date:
            end_dt = datetime(end_date.year, end_date.month, end_date.day) + timedelta(days=1)
            query = query.filter(ChangeRequest.created_at < end_dt)
        for c in query.order_by(ChangeRequest.id).all():
            requester = db.query(User).filter(User.id == c.requester_id).first()
            writer.writerow([
                f"CHG{c.id:06d}", "change_request", c.title, getattr(c, 'category', '') or "",
                c.risk_level.value if c.risk_level else "",
                c.status.value if c.status else "",
                requester.full_name if requester else "",
                "", c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "", ""
            ])
    else:
        # Export tickets (incidents and/or service requests)
        query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
        query = apply_filters(query, ticket_type, start_date, end_date)
        for t in query.order_by(Ticket.id).all():
            if t.ticket_type == TicketType.INCIDENT:
                ticket_ref = f"INC{t.id:06d}"
            elif t.ticket_type == TicketType.SERVICE_REQUEST:
                ticket_ref = f"REQ{t.id:06d}"
            else:
                ticket_ref = f"TKT{t.id:06d}"
            writer.writerow([
                ticket_ref, t.ticket_type.value if t.ticket_type else "",
                t.title, t.category or "", t.priority.value if t.priority else "",
                t.status.value if t.status else "",
                t.requester.full_name if t.requester else "",
                t.assigned_to.full_name if t.assigned_to else "",
                t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
                compute_sla_status(t)
            ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "filename=tickets_export.csv"}
    )

# =============================================================================
# CHANGE MANAGEMENT (fixed permissions)
# =============================================================================

@app.post("/changes/", response_model=ChangeOut)
def create_change(change: ChangeCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_change = ChangeRequest(
        tenant_id=current_user.tenant_id,
        title=change.title,
        description=change.description,
        risk_level=change.risk_level,
        planned_date=change.planned_date,
        requester_id=current_user.id,
        status=ChangeStatus.PENDING_APPROVAL
    )
    db.add(db_change)
    db.commit()
    db.refresh(db_change)
    return _change_to_out(db_change)

@app.get("/changes/")
def list_changes(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    query = db.query(ChangeRequest).filter(ChangeRequest.tenant_id == current_user.tenant_id)

    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        query = query.filter(ChangeRequest.requester_id == current_user.id)

    total = query.count()
    changes = query.order_by(ChangeRequest.created_at.desc()).offset(skip).limit(limit).all()
    return {"items": [_change_to_out(c) for c in changes], "total": total, "skip": skip, "limit": limit}

@app.get("/changes/{change_id}", response_model=ChangeOut)
def get_change(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and change.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _change_to_out(change)

@app.patch("/changes/{change_id}", response_model=ChangeOut)
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
    for field, value in update_data.items():
        setattr(change, field, value)
    db.commit()
    db.refresh(change)
    return _change_to_out(change)

@app.post("/changes/{change_id}/approve", response_model=ChangeOut)
def approve_change(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status != ChangeStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Change is not in pending approval status")
    change.status = ChangeStatus.APPROVED
    db.commit()
    db.refresh(change)
    requester = db.query(User).filter(User.id == change.requester_id).first()
    if requester:
        send_email(requester.email,
                   f"Change approved: #{change.id} {change.title}",
                   f"Your change request has been approved.\n\nView: {FRONTEND_URL}/changes/{change.id}")
    return _change_to_out(change)

@app.post("/changes/{change_id}/reject", response_model=ChangeOut)
def reject_change(change_id: int, comment: CommentCreate,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.APPROVE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status != ChangeStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Change is not in pending approval status")
    change.status = ChangeStatus.REJECTED
    db.commit()
    db.refresh(change)
    requester = db.query(User).filter(User.id == change.requester_id).first()
    if requester:
        send_email(requester.email,
                   f"Change rejected: #{change.id} {change.title}",
                   f"Your change request has been rejected.\nReason: {comment.body}\n\nView: {FRONTEND_URL}/changes/{change.id}")
    return _change_to_out(change)

def _change_to_out(change: ChangeRequest) -> dict:
    requester = change.requester
    return {
        "id": change.id,
        "title": change.title,
        "description": change.description,
        "risk_level": change.risk_level,
        "status": change.status,
        "requester_id": change.requester_id,
        "requester_name": requester.full_name if requester else "Unknown",
        "assigned_to_id": change.assigned_to_id,
        "planned_date": change.planned_date,
        "created_at": change.created_at,
        "updated_at": change.updated_at,
    }

# =============================================================================
# =============================================================================
# =============================================================================
# APPROVAL WORKFLOWS
# =============================================================================

@app.get("/approval-workflows/")
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

@app.post("/approval-workflows/")
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

@app.put("/approval-workflows/{workflow_id}")
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

@app.delete("/approval-workflows/{workflow_id}")
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

@app.get("/tickets/{ticket_id}/approvals")
def get_ticket_approvals(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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

@app.post("/tickets/{ticket_id}/approvals/{approval_id}/decide")
def decide_approval(ticket_id: int, approval_id: int, data: dict,
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    if approval.approver_role and current_user.role.value != approval.approver_role and not can_approve:
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
        ticket.status = TicketStatus.CLOSED
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
            ticket.status = TicketStatus.OPEN
            create_notification(db, ticket.requester_id, ticket.tenant_id,
                "approval_approved",
                f"✅ Request approved: {ticket.title}",
                "All approval steps completed. Your request is now being processed.",
                f"/tickets/{ticket_id}")

    db.commit()
    return {"ok": True, "decision": decision}

# =============================================================================
# BULK TICKET OPERATIONS
# =============================================================================

@app.post("/tickets/bulk-update")
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
                old_status = ticket.status.value
                ticket.status = TicketStatus(value)
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="status_changed", field="status",
                    old_value=old_status, new_value=value)

            elif action == "priority":
                ticket.priority = TicketPriority(value)
                log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                    action="status_changed", field="priority",
                    old_value=ticket.priority.value, new_value=value)

            updated += 1
        except Exception:
            continue

    db.commit()
    return {"updated": updated, "total": len(ticket_ids)}

# NOTIFICATIONS
# =============================================================================

@app.get("/notifications/")
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

@app.patch("/notifications/{notification_id}/read")
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

@app.post("/notifications/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}

# =============================================================================
# BRANDING (ADMIN ONLY)
# =============================================================================

LOGO_DIR = "logos"
os.makedirs(LOGO_DIR, exist_ok=True)

@app.get("/branding/public")
def get_public_branding(db: Session = Depends(get_db)):
    """Public endpoint — returns branding for the default tenant. Used on login page."""
    tenant = db.query(Tenant).filter(Tenant.is_active == True).first()
    if not tenant:
        return {"company_name": "ITSM Portal", "primary_color": "#4f46e5",
                "accent_color": "#818cf8", "logo_url": None, "company_tagline": None}
    return {
        "company_name": tenant.name,
        "primary_color": tenant.primary_color or "#4f46e5",
        "accent_color": tenant.accent_color or "#818cf8",
        "logo_url": tenant.logo_url,
        "company_tagline": tenant.company_tagline,
    }

@app.get("/admin/branding")
def get_branding(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "company_name": tenant.name,
        "company_tagline": tenant.company_tagline or "",
        "primary_color": tenant.primary_color or "#4f46e5",
        "accent_color": tenant.accent_color or "#818cf8",
        "logo_url": tenant.logo_url,
        "support_email": tenant.support_email or "",
        "plan": tenant.plan or "free",
        "plan_limits": get_plan_limits(tenant.plan),
    }

@app.put("/admin/branding")
def update_branding(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if not get_plan_limits(tenant.plan)["branding"]:
        raise HTTPException(status_code=403, detail="Custom branding is available on the Pro plan and above. Please upgrade your plan.")
    if data.get("company_name"):
        tenant.name = data["company_name"]
    if "company_tagline" in data:
        tenant.company_tagline = data["company_tagline"]
    if data.get("primary_color"):
        tenant.primary_color = data["primary_color"]
    if data.get("accent_color"):
        tenant.accent_color = data["accent_color"]
    if "support_email" in data:
        tenant.support_email = data["support_email"]
    if data.get("logo_url") and "cloudinary.com" in str(data["logo_url"]):
        tenant.logo_url = data["logo_url"]
    elif "logo_url" in data and not data["logo_url"]:
        tenant.logo_url = None  # explicitly clearing the logo
    log_system_event(db, admin, "branding.updated",
                     target_type="tenant", target_id=tenant.id, target_label=tenant.name)
    db.commit()
    return {"ok": True}

@app.post("/admin/branding/logo")
async def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_db),
                      admin: User = Depends(get_current_admin_user)):
    allowed = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, SVG and WebP images allowed")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB")

    if CLOUDINARY_CLOUD_NAME:
        # Upload to Cloudinary
        public_id = f"tenant_{admin.tenant_id}_logo"
        logo_url = upload_to_cloudinary(content, public_id, folder="dodesk/logos")
    else:
        # Fallback to local storage
        ext = file.filename.rsplit(".", 1)[-1].lower()
        filename = f"tenant_{admin.tenant_id}_logo.{ext}"
        path = os.path.join(LOGO_DIR, filename)
        with open(path, "wb") as f:
            f.write(content)
        logo_url = f"/logos/{filename}"

    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    tenant.logo_url = logo_url
    db.commit()
    return {"logo_url": logo_url}

@app.get("/logos/{filename}")
def serve_logo(filename: str):
    path = os.path.join(LOGO_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path)

# =============================================================================
# SLA CONFIGURATION (ADMIN ONLY)
# =============================================================================

@app.get("/admin/sla-config")
def get_sla_config(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    cfg = db.query(SLAConfig).filter(SLAConfig.tenant_id == admin.tenant_id).first()
    defaults = SLA_RULES
    return {
        "low_response":      cfg.low_response      if cfg else defaults["low"]["response"],
        "low_resolution":    cfg.low_resolution    if cfg else defaults["low"]["resolution"],
        "medium_response":   cfg.medium_response   if cfg else defaults["medium"]["response"],
        "medium_resolution": cfg.medium_resolution if cfg else defaults["medium"]["resolution"],
        "high_response":     cfg.high_response     if cfg else defaults["high"]["response"],
        "high_resolution":   cfg.high_resolution   if cfg else defaults["high"]["resolution"],
        "critical_response":     cfg.critical_response     if cfg else defaults["critical"]["response"],
        "critical_resolution":   cfg.critical_resolution   if cfg else defaults["critical"]["resolution"],
    }

@app.put("/admin/sla-config")
def update_sla_config(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if tenant and not get_plan_limits(tenant.plan)["sla"]:
        raise HTTPException(status_code=403, detail="SLA configuration is available on the Pro plan and above. Please upgrade your plan.")
    cfg = db.query(SLAConfig).filter(SLAConfig.tenant_id == admin.tenant_id).first()
    if not cfg:
        cfg = SLAConfig(tenant_id=admin.tenant_id)
        db.add(cfg)
    cfg.low_response      = int(data.get("low_response", 8))
    cfg.low_resolution    = int(data.get("low_resolution", 72))
    cfg.medium_response   = int(data.get("medium_response", 4))
    cfg.medium_resolution = int(data.get("medium_resolution", 48))
    cfg.high_response     = int(data.get("high_response", 2))
    cfg.high_resolution   = int(data.get("high_resolution", 24))
    cfg.critical_response     = int(data.get("critical_response", 1))
    cfg.critical_resolution   = int(data.get("critical_resolution", 8))
    log_system_event(db, admin, "sla_config.updated",
                     target_type="tenant", target_id=admin.tenant_id)
    db.commit()
    return {"ok": True}

# =============================================================================
# ESCALATION RULES (ADMIN ONLY)
# =============================================================================

@app.get("/admin/escalation-rules")
def list_escalation_rules(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rules = db.query(EscalationRule).filter(
        EscalationRule.tenant_id == admin.tenant_id,
        EscalationRule.is_active == True
    ).all()
    result = []
    for r in rules:
        agent = db.query(User).filter(User.id == r.escalate_to_id).first() if r.escalate_to_id else None
        result.append({
            "id": r.id, "name": r.name, "priority": r.priority,
            "idle_hours": r.idle_hours,
            "escalate_to_id": r.escalate_to_id,
            "escalate_to_name": agent.full_name if agent else None,
            "escalate_to_role": r.escalate_to_role,
            "created_at": r.created_at,
        })
    return result

@app.post("/admin/escalation-rules")
def create_escalation_rule(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rule = EscalationRule(
        tenant_id=admin.tenant_id,
        name=data.get("name", ""),
        priority=data.get("priority") or None,
        idle_hours=int(data.get("idle_hours", 24)),
        escalate_to_id=int(data["escalate_to_id"]) if data.get("escalate_to_id") else None,
        escalate_to_role=data.get("escalate_to_role") or None,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "name": rule.name}

@app.delete("/admin/escalation-rules/{rule_id}")
def delete_escalation_rule(rule_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rule = db.query(EscalationRule).filter(
        EscalationRule.id == rule_id,
        EscalationRule.tenant_id == admin.tenant_id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.is_active = False
    db.commit()
    return {"ok": True}

# =============================================================================
# BUSINESS HOURS CONFIGURATION (ADMIN ONLY)
# =============================================================================

@app.get("/admin/business-hours")
def get_business_hours(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    cfg = db.query(BusinessHoursConfig).filter(BusinessHoursConfig.tenant_id == admin.tenant_id).first()
    if not cfg:
        return {"enabled": False, "start_hour": 9, "end_hour": 17,
                "working_days": "0,1,2,3,4", "timezone": "UTC"}
    return {"enabled": cfg.enabled, "start_hour": cfg.start_hour,
            "end_hour": cfg.end_hour, "working_days": cfg.working_days,
            "timezone": cfg.timezone}

@app.put("/admin/business-hours")
def update_business_hours(data: dict, db: Session = Depends(get_db),
                          admin: User = Depends(get_current_admin_user)):
    cfg = db.query(BusinessHoursConfig).filter(BusinessHoursConfig.tenant_id == admin.tenant_id).first()
    if not cfg:
        cfg = BusinessHoursConfig(tenant_id=admin.tenant_id)
        db.add(cfg)
    cfg.enabled = data.get("enabled", False)
    cfg.start_hour = int(data.get("start_hour", 9))
    cfg.end_hour = int(data.get("end_hour", 17))
    cfg.working_days = data.get("working_days", "0,1,2,3,4")
    cfg.timezone = data.get("timezone", "UTC")
    db.commit()
    return {"ok": True}

# =============================================================================
# SECURITY CONFIGURATION (MFA + SSO) — ADMIN ONLY
# =============================================================================

@app.get("/admin/security-config")
def get_security_config(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "mfa_enabled": bool(tenant.mfa_enabled),
        "mfa_required": bool(tenant.mfa_required),
        "sso_enabled": bool(tenant.sso_enabled),
        "sso_provider": tenant.sso_provider or "google",
        "sso_client_id": tenant.sso_client_id or "",
        "sso_client_secret": "",  # never return secrets
        "sso_domain": tenant.sso_domain or "",
        "sso_tenant_id": tenant.sso_tenant_id or "",
    }

@app.put("/admin/security-config")
def update_security_config(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    limits = get_plan_limits(tenant.plan)
    if data.get("mfa_enabled") and not limits["mfa"]:
        raise HTTPException(status_code=403, detail="Two-factor authentication is available on the Pro plan and above. Please upgrade your plan.")
    if data.get("sso_enabled") and not limits["sso"]:
        raise HTTPException(status_code=403, detail="Single sign-on (SSO) is available on the Pro plan and above. Please upgrade your plan.")

    tenant.mfa_enabled = bool(data.get("mfa_enabled", False))
    tenant.mfa_required = bool(data.get("mfa_required", False)) if tenant.mfa_enabled else False
    tenant.sso_enabled = bool(data.get("sso_enabled", False))
    tenant.sso_provider = data.get("sso_provider", "google")
    tenant.sso_client_id = data.get("sso_client_id") or None
    if data.get("sso_client_secret"):
        tenant.sso_client_secret = data.get("sso_client_secret")
    tenant.sso_domain = data.get("sso_domain") or None
    tenant.sso_tenant_id = data.get("sso_tenant_id") or None
    log_system_event(db, admin, "security_config.updated",
                     target_type="tenant", target_id=tenant.id, target_label=tenant.name,
                     new_value=f"mfa={tenant.mfa_enabled} mfa_required={tenant.mfa_required} sso={tenant.sso_enabled}")
    db.commit()
    return {"ok": True}

# =============================================================================
# EMAIL CONFIGURATION (ADMIN ONLY)
# =============================================================================

@app.get("/admin/email-config")
def get_email_config_endpoint(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    cfg = db.query(EmailConfig).filter(EmailConfig.tenant_id == admin.tenant_id).first()
    if not cfg:
        return {
            "smtp_host": SMTP_HOST, "smtp_port": SMTP_PORT,
            "smtp_user": SMTP_USER, "smtp_pass": "",
            "smtp_from": SMTP_FROM,
            "slack_webhook_url": SLACK_WEBHOOK_URL,
            "teams_webhook_url": TEAMS_WEBHOOK_URL,
        }
    return {
        "smtp_host": cfg.smtp_host or "",
        "smtp_port": cfg.smtp_port or 587,
        "smtp_user": cfg.smtp_user or "",
        "smtp_pass": "",  # never expose password
        "smtp_from": cfg.smtp_from or "noreply@itsm.local",
        "slack_webhook_url": cfg.slack_webhook_url or "",
        "teams_webhook_url": cfg.teams_webhook_url or "",
    }

@app.put("/admin/email-config")
def update_email_config(
    data: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    cfg = db.query(EmailConfig).filter(EmailConfig.tenant_id == admin.tenant_id).first()
    if not cfg:
        cfg = EmailConfig(tenant_id=admin.tenant_id)
        db.add(cfg)
    cfg.smtp_host = data.get("smtp_host", "")
    cfg.smtp_port = int(data.get("smtp_port", 587))
    cfg.smtp_user = data.get("smtp_user", "")
    if data.get("smtp_pass"):  # only update password if provided
        cfg.smtp_pass = data.get("smtp_pass")
    cfg.smtp_from = data.get("smtp_from", "noreply@itsm.local")
    cfg.slack_webhook_url = data.get("slack_webhook_url", "")
    cfg.teams_webhook_url = data.get("teams_webhook_url", "")
    db.commit()
    return {"ok": True}

@app.post("/admin/email-config/test")
def test_email_config(
    data: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """Send a test email using the provided config."""
    to = data.get("test_email") or admin.email
    cfg = {
        "smtp_host": data.get("smtp_host", ""),
        "smtp_port": int(data.get("smtp_port", 587)),
        "smtp_user": data.get("smtp_user", ""),
        "smtp_pass": data.get("smtp_pass", ""),
        "smtp_from": data.get("smtp_from", "noreply@itsm.local"),
    }
    try:
        send_email(to, "ITSM Test Email", "This is a test email from your ITSM portal.", cfg)
        return {"ok": True, "message": f"Test email sent to {to}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# USER MANAGEMENT (ADMIN ONLY, tenant‑scoped)
# =============================================================================

@app.get("/admin/users")
def admin_list_users(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=1000), db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    if admin.role == UserRole.SUPER_ADMIN:
        query = db.query(User)  # all tenants
    else:
        query = db.query(User).filter(User.tenant_id == admin.tenant_id)
    total = query.count()
    users = query.order_by(User.tenant_id, User.id).offset(skip).limit(limit).all()
    result = []
    for u in users:
        tenant = db.query(Tenant).filter(Tenant.id == u.tenant_id).first()
        result.append({
            "id": u.id, "email": u.email, "full_name": u.full_name,
            "role": u.role, "is_active": u.is_active,
            "job_title": u.job_title, "department": u.department,
            "tenant_id": u.tenant_id,
            "tenant_name": tenant.name if tenant else "—",
            "created_at": u.created_at,
            "is_locked": bool(u.locked_until and u.locked_until > datetime.utcnow()),
            "status_changed_at": u.status_changed_at,
        })
    return {"items": result, "total": total, "skip": skip, "limit": limit}

@app.post("/admin/users", response_model=UserOut)
def admin_create_user(user_data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    validate_password_strength(user_data.password)
    # Allow super-admin to assign user to a different tenant
    target_tenant_id = admin.tenant_id
    if hasattr(user_data, 'tenant_id') and user_data.tenant_id:
        tenant = db.query(Tenant).filter(Tenant.id == user_data.tenant_id).first()
        if tenant:
            target_tenant_id = tenant.id
    check_user_limit(db, target_tenant_id, additional=1, role=user_data.role)
    new_user = User(
        tenant_id=target_tenant_id,
        email=user_data.email,
        hashed_password=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role=user_data.role,
        job_title=user_data.job_title,
        department=user_data.department,
        is_active=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    log_system_event(db, admin, "user.created",
                     target_type="user", target_id=new_user.id,
                     target_label=new_user.email,
                     new_value=user_data.role if isinstance(user_data.role, str) else user_data.role.value)
    db.commit()
    # Sync Paddle overage if tenant is in grace zone
    tenant_obj = db.query(Tenant).filter(Tenant.id == target_tenant_id).first()
    sync_paddle_overage(db, tenant_obj)
    return new_user

@app.post("/admin/users/bulk-import")
async def bulk_import_users(file: UploadFile = File(...), db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Bulk-create users from a CSV or XLSX file. Expected columns (header row required):
    full_name, email, role, job_title, department, password (optional), tenant (optional, super_admin only)
    If password is omitted, a random temporary password is generated.
    """
    content = await file.read()
    filename = (file.filename or "").lower()

    rows_data = []  # list of dicts, normalized lowercase keys

    if filename.endswith(".xlsx") or filename.endswith(".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(status_code=500, detail="Excel import is not available on this server (openpyxl not installed). Please use CSV instead, or contact support.")
        try:
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
            ws = wb.active
            all_rows = list(ws.iter_rows(values_only=True))
            if not all_rows:
                raise HTTPException(status_code=400, detail="Spreadsheet appears to be empty")
            headers = [str(h or "").strip().lower() for h in all_rows[0]]
            for r in all_rows[1:]:
                if all(c is None or str(c).strip() == "" for c in r):
                    continue  # skip fully empty rows
                row_dict = {headers[idx]: ("" if r[idx] is None else str(r[idx]).strip()) for idx in range(len(headers)) if idx < len(r)}
                rows_data.append(row_dict)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read Excel file: {e}")
    else:
        try:
            text_content = content.decode("utf-8-sig")  # handle BOM from Excel CSV exports
        except UnicodeDecodeError:
            text_content = content.decode("latin-1")

        reader = csv.DictReader(io.StringIO(text_content))
        if reader.fieldnames is None:
            raise HTTPException(status_code=400, detail="CSV file appears to be empty or invalid")
        reader.fieldnames = [(f or "").strip().lower() for f in reader.fieldnames]
        headers = reader.fieldnames
        for row in reader:
            rows_data.append({k: (v or "") for k, v in row.items()})

    required_cols = {"full_name", "email"}
    missing = required_cols - set(headers)
    if missing:
        raise HTTPException(status_code=400, detail=f"File is missing required column(s): {', '.join(missing)}")

    valid_roles = {r.value for r in UserRole}
    results = {"created": [], "skipped": [], "errors": []}

    for i, row in enumerate(rows_data, start=2):  # start=2 because row 1 is the header
        email = (row.get("email") or "").strip().lower()
        full_name = (row.get("full_name") or "").strip()

        if not email or not full_name:
            results["errors"].append({"row": i, "email": email, "reason": "Missing full_name or email"})
            continue

        if db.query(User).filter(User.email == email).first():
            results["skipped"].append({"row": i, "email": email, "reason": "Email already exists"})
            continue

        role_raw = (row.get("role") or "employee").strip().lower()
        if role_raw not in valid_roles or role_raw == "super_admin":
            role_raw = "employee"

        # Determine tenant
        target_tenant_id = admin.tenant_id
        tenant_identifier = (row.get("tenant") or row.get("tenant_slug") or "").strip()
        if admin.role == UserRole.SUPER_ADMIN and tenant_identifier:
            tenant = db.query(Tenant).filter(
                (sa_func.lower(Tenant.slug) == tenant_identifier.lower()) |
                (sa_func.lower(Tenant.name) == tenant_identifier.lower())
            ).first()
            if tenant:
                target_tenant_id = tenant.id
            else:
                results["errors"].append({"row": i, "email": email, "reason": f"Unknown tenant '{tenant_identifier}' (use exact company name or slug)"})
                continue

        password = (row.get("password") or "").strip()
        temp_password_generated = False
        if not password:
            password = _secrets.token_urlsafe(9)  # ~12 char random password
            temp_password_generated = True

        try:
            validate_password_strength(password)
        except HTTPException:
            password = _secrets.token_urlsafe(9)
            temp_password_generated = True

        try:
            check_user_limit(db, target_tenant_id, additional=1, role=role_raw)
        except HTTPException as e:
            results["errors"].append({"row": i, "email": email, "reason": e.detail})
            continue

        new_user = User(
            tenant_id=target_tenant_id,
            email=email,
            hashed_password=get_password_hash(password),
            full_name=full_name,
            role=UserRole(role_raw),
            job_title=(row.get("job_title") or "").strip() or None,
            department=(row.get("department") or "").strip() or None,
            is_active=True,
        )
        db.add(new_user)
        try:
            db.flush()
        except Exception as e:
            db.rollback()
            results["errors"].append({"row": i, "email": email, "reason": str(e)})
            continue

        results["created"].append({
            "row": i, "email": email, "full_name": full_name, "role": role_raw,
            "temp_password": password if temp_password_generated else None,
        })

    db.commit()
    return results

@app.post("/admin/users/{user_id}/unlock")
def unlock_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    user = db.query(User).filter(User.id == user_id, User.tenant_id == admin.tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.locked_until = None
    user.failed_login_attempts = 0
    log_system_event(db, admin, "user.unlocked",
                     target_type="user", target_id=user.id, target_label=user.email)
    db.commit()
    return {"ok": True, "message": f"{user.full_name} has been unlocked."}

@app.get("/admin/users/{user_id}", response_model=UserOut)
def admin_get_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.patch("/admin/users/{user_id}", response_model=UserOut)
def admin_update_user(user_id: int, user_update: UserUpdate,
                      db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    update_data = user_update.model_dump(exclude_unset=True)
    if "password" in update_data:
        validate_password_strength(update_data["password"])
        user.hashed_password = get_password_hash(update_data.pop("password"))
        log_system_event(db, admin, "user.password_reset",
                         target_type="user", target_id=user.id, target_label=user.email)
    if "is_active" in update_data and update_data["is_active"] != user.is_active:
        user.status_changed_at = datetime.utcnow()
        action = "user.activated" if update_data["is_active"] else "user.deactivated"
        log_system_event(db, admin, action,
                         target_type="user", target_id=user.id, target_label=user.email)
    if "role" in update_data and str(update_data["role"]) != str(user.role):
        log_system_event(db, admin, "user.role_changed",
                         target_type="user", target_id=user.id, target_label=user.email,
                         old_value=str(user.role), new_value=str(update_data["role"]))
    if "tenant_id" in update_data:
        tenant = db.query(Tenant).filter(Tenant.id == update_data["tenant_id"]).first()
        if not tenant:
            raise HTTPException(status_code=400, detail="Invalid tenant")
    for key, value in update_data.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user

# =============================================================================
# CANNED RESPONSES (permissions)
# =============================================================================

@app.get("/canned-responses/")
def list_canned_responses(
    category: str | None = Query(None),
    search: str | None = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(CannedResponse)
    if category:
        query = query.filter(CannedResponse.category == category)
    if search:
        query = query.filter(
            CannedResponse.title.ilike(f"%{search}%") |
            CannedResponse.content.ilike(f"%{search}%") |
            CannedResponse.category.ilike(f"%{search}%")
        )
    total = query.count()
    responses = query.order_by(CannedResponse.title).offset(skip).limit(limit).all()
    result = []
    for r in responses:
        author = db.query(User).filter(User.id == r.author_id).first()
        result.append({
            "id": r.id,
            "title": r.title,
            "content": r.content,
            "category": r.category,
            "author_id": r.author_id,
            "author_name": author.full_name if author else "Unknown",
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        })
    return {"items": result, "total": total, "skip": skip, "limit": limit}

@app.post("/canned-responses/", response_model=CannedResponseOut)
def create_canned_response(
    response: CannedResponseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_CANNED):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_response = CannedResponse(
        title=response.title,
        content=response.content,
        category=response.category,
        author_id=current_user.id
    )
    db.add(db_response)
    db.commit()
    db.refresh(db_response)
    return {
        "id": db_response.id,
        "title": db_response.title,
        "content": db_response.content,
        "category": db_response.category,
        "author_id": db_response.author_id,
        "author_name": current_user.full_name,
        "created_at": db_response.created_at,
        "updated_at": db_response.updated_at,
    }

@app.put("/canned-responses/{response_id}", response_model=CannedResponseOut)
def update_canned_response(
    response_id: int,
    response_update: CannedResponseUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_CANNED):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_response = db.query(CannedResponse).filter(CannedResponse.id == response_id).first()
    if not db_response:
        raise HTTPException(status_code=404, detail="Canned response not found")
    update_data = response_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_response, key, value)
    db.commit()
    db.refresh(db_response)
    author = db.query(User).filter(User.id == db_response.author_id).first()
    return {
        "id": db_response.id,
        "title": db_response.title,
        "content": db_response.content,
        "category": db_response.category,
        "author_id": db_response.author_id,
        "author_name": author.full_name if author else "Unknown",
        "created_at": db_response.created_at,
        "updated_at": db_response.updated_at,
    }

@app.delete("/canned-responses/{response_id}")
def delete_canned_response(
    response_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_CANNED):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_response = db.query(CannedResponse).filter(CannedResponse.id == response_id).first()
    if not db_response:
        raise HTTPException(status_code=404, detail="Canned response not found")
    db.delete(db_response)
    db.commit()
    return {"detail": "Canned response deleted"}

# =============================================================================
# SETTINGS
# =============================================================================

@app.put("/users/me", response_model=UserOut)
def update_profile(
    update: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if update.email is not None and update.email != current_user.email:
        if db.query(User).filter(User.email == update.email).first():
            raise HTTPException(status_code=400, detail="Email already in use")
    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role.value,
        "is_active": current_user.is_active,
        "language": current_user.language or "en",
        "theme": current_user.theme or "light",
        "profile_photo": current_user.profile_photo,
        "job_title": current_user.job_title,
        "department": current_user.department,
        "created_at": current_user.created_at,
    }

@app.put("/users/me/password")
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

# =============================================================================
# MFA (TOTP) — enrollment, verification, disable
# =============================================================================

@app.get("/users/me/mfa/status")
def mfa_status(current_user: User = Depends(get_current_user)):
    return {
        "mfa_enabled": bool(current_user.mfa_enabled),
        "backup_codes_remaining": len(json.loads(current_user.mfa_backup_codes or "[]")),
    }

@app.post("/users/me/mfa/setup")
def mfa_setup(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Step 1: generate a new secret and return QR provisioning URI. Not yet enabled until confirmed."""
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled. Disable it first to re-enroll.")
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if tenant and not get_plan_limits(tenant.plan)["mfa"]:
        raise HTTPException(status_code=403, detail="Two-factor authentication is available on the Pro plan and above. Please upgrade your plan.")
    secret = generate_totp_secret()
    current_user.mfa_secret = secret  # stored but mfa_enabled stays False until confirmed
    db.commit()
    uri = totp_provisioning_uri(secret, current_user.email, issuer="DodoDesk")
    return {"secret": secret, "provisioning_uri": uri}

@app.post("/users/me/mfa/confirm")
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

@app.post("/users/me/mfa/disable")
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

@app.post("/users/me/photo")
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
        # Upload to Cloudinary
        public_id = f"user_{current_user.id}_avatar"
        photo_url = upload_to_cloudinary(file_bytes, public_id, folder="dodesk/avatars")
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

@app.get("/users/me/photo")
def get_profile_photo(current_user: User = Depends(get_current_user)):
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No photo")
    # If it's a Cloudinary URL, redirect to it
    if current_user.profile_photo.startswith('http'):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=current_user.profile_photo)
    # Local file fallback
    file_path = os.path.join(AVATAR_DIR, current_user.profile_photo)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(file_path, media_type="image/jpeg")

# =============================================================================
# SERVICE CATALOG ENDPOINTS
# =============================================================================

@app.get("/catalog/")
def list_catalog_items(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True
    ).all()
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
        "is_active": item.is_active, "is_featured": item.is_featured or False, "created_at": item.created_at,
    }

@app.get("/catalog/{item_id}")
def get_catalog_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    return _catalog_to_out(item)

@app.post("/catalog/")
def create_catalog_item(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
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
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return _catalog_to_out(db_item)

@app.put("/catalog/{item_id}")
def update_catalog_item(item_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_CATALOG):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    item = db.query(ServiceCatalogItem).filter(
        ServiceCatalogItem.id == item_id,
        ServiceCatalogItem.tenant_id == current_user.tenant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    item.name = data.get("name", item.name)
    item.description = data.get("description", item.description)
    item.category = data.get("category", item.category)
    item.estimated_cost = data.get("estimated_cost", item.estimated_cost)
    item.delivery_time_days = data.get("delivery_time_days", item.delivery_time_days)
    item.approval_required = data.get("approval_required", item.approval_required)
    item.ticket_title = data.get("ticket_title", item.ticket_title)
    item.ticket_description = data.get("ticket_description", item.ticket_description)
    item.ticket_type = data.get("ticket_type", item.ticket_type or "service_request")
    item.priority = data.get("priority", item.priority or "medium")
    item.is_onboarding = data.get("is_onboarding", item.is_onboarding or False)
    item.is_featured = data.get("is_featured", item.is_featured if item.is_featured is not None else False)
    if "onboarding_tasks" in data:
        item.onboarding_tasks = json.dumps(data["onboarding_tasks"])
    db.commit()
    return _catalog_to_out(item)

@app.post("/catalog/{item_id}/onboard")
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
            ticket_type=TicketType.SERVICE_REQUEST,
            title=title,
            description=description,
            category=task.get("category", "Onboarding"),
            priority=TicketPriority(task.get("priority", "medium")),
            requester_id=current_user.id,
            assigned_to_id=assignee_id,
            status=TicketStatus.OPEN,
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

@app.delete("/catalog/{item_id}")
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

# =============================================================================
# CUSTOM ROLES (ADMIN)
# =============================================================================

@app.get("/admin/roles", response_model=list[CustomRoleOut])
def list_custom_roles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_USERS):
        raise HTTPException(status_code=403)
    roles = db.query(CustomRole).filter(CustomRole.tenant_id == current_user.tenant_id).all()
    return roles

@app.post("/admin/roles", response_model=CustomRoleOut)
def create_custom_role(
    role: CustomRoleCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_USERS):
        raise HTTPException(status_code=403)
    db_role = CustomRole(
        tenant_id=current_user.tenant_id,
        name=role.name,
        permissions=json.dumps([p.value for p in role.permissions])
    )
    db.add(db_role)
    db.commit()
    db.refresh(db_role)
    return db_role

# =============================================================================
# BILLING (Paddle)
# =============================================================================

def paddle_api_request(method: str, path: str, body: dict | None = None) -> dict:
    """Make an authenticated request to the Paddle API. Raises HTTPException on failure."""
    if not PADDLE_API_KEY:
        raise HTTPException(status_code=500, detail="Billing is not configured on this server.")
    url = f"{PADDLE_API_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {PADDLE_API_KEY}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        raise HTTPException(status_code=502, detail=f"Paddle API error: {err_body}")


def sync_paddle_overage(db: Session, tenant: Tenant):
    """If tenant is on Pro and has extra seats (6-10), update the Paddle subscription
    to charge for the overage seats. Silently skips if no subscription or not in grace zone."""
    if not tenant or not tenant.paddle_subscription_id or not PADDLE_API_KEY:
        return
    limits = get_plan_limits(tenant.plan)
    max_users = limits.get("max_users")
    grace = limits.get("grace_users", 0)
    if max_users is None or grace == 0:
        return  # Enterprise (unlimited) or no grace zone

    staff_count = db.query(User).filter(
        User.tenant_id == tenant.id,
        User.role.in_([UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN])
    ).count()

    extra_seats = max(staff_count - max_users, 0)
    extra_seats = min(extra_seats, grace)  # cap at grace zone limit

    try:
        # Get current subscription items to find the item ID
        sub = paddle_api_request("GET", f"/subscriptions/{tenant.paddle_subscription_id}")
        items = sub.get("data", {}).get("items", [])
        if not items:
            return
        item_id = items[0].get("price", {}).get("id")
        if not item_id:
            return

        # Update subscription quantity — base quantity (1) + extra seats
        paddle_api_request("PATCH", f"/subscriptions/{tenant.paddle_subscription_id}", body={
            "items": [{"price_id": item_id, "quantity": 1 + extra_seats}],
            "proration_billing_mode": "prorated_immediately",
        })
        print(f"✅ Paddle overage updated for tenant {tenant.id}: {extra_seats} extra seat(s)")
    except Exception as e:
        print(f"⚠️ Paddle overage sync failed for tenant {tenant.id}: {e}")
        # Don't raise — overage sync failure shouldn't block user creation





@app.get("/billing/config")
def billing_config(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns public Paddle config + the current tenant's plan/billing status, for the frontend checkout UI."""
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    plan = tenant.plan if tenant else "free"
    limits = get_plan_limits(plan)

    staff_count = 0
    if tenant:
        staff_count = db.query(User).filter(
            User.tenant_id == tenant.id,
            User.role.in_([UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN])
        ).count()

    max_users = limits["max_users"]
    grace = limits.get("grace_users", 0)
    grace = limits.get("grace_users", 0)
    in_grace_zone = max_users is not None and grace > 0 and max_users < staff_count <= max_users + grace
    trial_status = get_trial_status(tenant) if tenant else {"on_trial": False, "trial_days_remaining": None, "trial_expired": False}

    return {
        "client_token": PADDLE_CLIENT_TOKEN,
        "environment": PADDLE_ENV,
        "price_pro_monthly": PADDLE_PRICE_PRO_MONTHLY,
        "price_pro_annual": PADDLE_PRICE_PRO_ANNUAL,
        "plan": plan,
        "plan_limits": limits,
        "billing_status": tenant.billing_status if tenant else None,
        "plan_renews_at": tenant.plan_renews_at if tenant else None,
        "has_subscription": bool(tenant and tenant.paddle_subscription_id),
        "staff_count": staff_count,
        "in_grace_zone": in_grace_zone,
        "seats_over_limit": max(staff_count - max_users, 0) if max_users is not None else 0,
        **trial_status,
    }


@app.post("/billing/checkout")
def billing_create_checkout(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Prepare checkout details for the Paddle overlay. Returns price_id + customer info;
    actual checkout session is opened client-side via Paddle.js using these details."""
    interval = data.get("interval", "month")  # "month" or "year"
    price_id = PADDLE_PRICE_PRO_ANNUAL if interval == "year" else PADDLE_PRICE_PRO_MONTHLY
    if not price_id:
        raise HTTPException(status_code=500, detail="Pricing is not configured on this server.")

    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return {
        "price_id": price_id,
        "customer_email": admin.email,
        "tenant_id": tenant.id,
        "tenant_slug": tenant.slug,
    }


@app.post("/billing/portal")
def billing_customer_portal(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Generate a Paddle customer portal link so the admin can manage/cancel their subscription."""
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant or not tenant.paddle_customer_id:
        raise HTTPException(status_code=404, detail="No billing account found for this tenant yet.")

    result = paddle_api_request(
        "POST",
        f"/customers/{tenant.paddle_customer_id}/portal-sessions",
        body={},
    )
    portal_url = result.get("data", {}).get("urls", {}).get("general", {}).get("overview")
    if not portal_url:
        raise HTTPException(status_code=502, detail="Could not generate billing portal link.")
    return {"url": portal_url}


@app.post("/billing/webhook")
async def billing_webhook(request: Request, db: Session = Depends(get_db)):
    """Receives subscription lifecycle events from Paddle and updates the tenant's plan."""
    raw_body = await request.body()
    signature_header = request.headers.get("Paddle-Signature", "")

    if PADDLE_WEBHOOK_SECRET:
        if not verify_paddle_signature(raw_body, signature_header, PADDLE_WEBHOOK_SECRET):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_type = event.get("event_type", "")
    payload = event.get("data", {})

    if event_type in ("subscription.created", "subscription.activated", "subscription.updated"):
        customer_id = payload.get("customer_id")
        subscription_id = payload.get("id")
        status_value = payload.get("status")  # active, past_due, paused, canceled
        custom_data = payload.get("custom_data") or {}
        tenant_id = custom_data.get("tenant_id")

        tenant = None
        if tenant_id:
            tenant = db.query(Tenant).filter(Tenant.id == int(tenant_id)).first()
        if not tenant and customer_id:
            tenant = db.query(Tenant).filter(Tenant.paddle_customer_id == customer_id).first()

        if tenant:
            tenant.paddle_customer_id = customer_id or tenant.paddle_customer_id
            tenant.paddle_subscription_id = subscription_id
            tenant.billing_status = status_value
            # Determine plan from subscription status
            if status_value in ("active", "trialing"):
                tenant.plan = "pro"
            elif status_value in ("past_due",):
                pass  # keep current plan, but billing_status flags the issue
            elif status_value in ("canceled", "paused"):
                tenant.plan = "free"

            next_billed = payload.get("next_billed_at")
            if next_billed:
                try:
                    tenant.plan_renews_at = datetime.fromisoformat(next_billed.replace("Z", "+00:00"))
                except Exception:
                    pass

            db.commit()

    elif event_type in ("subscription.canceled", "subscription.paused"):
        subscription_id = payload.get("id")
        tenant = db.query(Tenant).filter(Tenant.paddle_subscription_id == subscription_id).first()
        if tenant:
            tenant.billing_status = "canceled"
            tenant.plan = "free"
            db.commit()

    return {"ok": True}


def verify_paddle_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """Verify Paddle webhook signature (format: 'ts=<timestamp>;h1=<hmac>')."""
    try:
        parts = dict(p.split("=", 1) for p in signature_header.split(";"))
        ts = parts.get("ts", "")
        h1 = parts.get("h1", "")
        signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
        computed = hmac_lib.new(secret.encode("utf-8"), signed_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac_lib.compare_digest(computed, h1)
    except Exception:
        return False

# =============================================================================
# AUDIT LOGS
# =============================================================================

@app.get("/admin/audit-log")
def get_audit_log(
    limit: int = 50,
    offset: int = 0,
    action: str = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """Returns system audit log for the current tenant (or all tenants for super_admin)."""
    query = db.query(SystemAuditLog)
    if admin.role != UserRole.SUPER_ADMIN:
        query = query.filter(SystemAuditLog.tenant_id == admin.tenant_id)
    if action:
        query = query.filter(SystemAuditLog.action.ilike(f"%{action}%"))
    total = query.count()
    logs = query.order_by(SystemAuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [{
            "id": log.id,
            "actor_email": log.actor_email,
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "target_label": log.target_label,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "created_at": log.created_at,
            "tenant_id": log.tenant_id,
        } for log in logs]
    }

@app.get("/admin/ticket-audit-log/{ticket_id}")
def get_ticket_audit_log(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns the audit trail for a specific ticket."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    logs = db.query(TicketAuditLog).filter(TicketAuditLog.ticket_id == ticket_id).order_by(TicketAuditLog.created_at.asc()).all()
    return [{
        "id": log.id,
        "actor_id": log.actor_id,
        "action": log.action,
        "field": log.field,
        "old_value": log.old_value,
        "new_value": log.new_value,
        "note": log.note,
        "created_at": log.created_at,
    } for log in logs]

# =============================================================================
# TENANT MANAGEMENT (super admin)

# =============================================================================

@app.get("/superadmin/tenants")
def list_tenants(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    if admin.role == UserRole.SUPER_ADMIN:
        tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    else:
        tenants = db.query(Tenant).filter(Tenant.id == admin.tenant_id).all()
    result = []
    for t in tenants:
        user_count = db.query(User).filter(User.tenant_id == t.id).count()
        staff_count = db.query(User).filter(
            User.tenant_id == t.id,
            User.role.in_([UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN])
        ).count()
        ticket_count = db.query(Ticket).filter(Ticket.tenant_id == t.id).count()
        result.append({
            "id": t.id, "name": t.name, "slug": t.slug,
            "primary_color": t.primary_color, "is_active": t.is_active,
            "support_email": t.support_email, "company_tagline": t.company_tagline,
            "created_at": t.created_at,
            "user_count": user_count, "staff_count": staff_count, "ticket_count": ticket_count,
            "plan": t.plan or "free",
            "max_users": get_plan_limits(t.plan)["max_users"],
        })
    return result

@app.post("/superadmin/tenants")
def create_tenant(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only the super admin can create tenants")
    # Validate slug uniqueness
    slug = data.get("slug", "").lower().strip().replace(" ", "-")
    if not slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        raise HTTPException(status_code=400, detail="A tenant with this slug already exists")

    tenant = Tenant(
        name=data.get("name", ""),
        slug=slug,
        primary_color=data.get("primary_color", "#4f46e5"),
        support_email=data.get("support_email", ""),
        company_tagline=data.get("company_tagline", ""),
        is_active=True,
    )
    db.add(tenant)
    db.flush()

    # Create default roles for tenant
    admin_role = CustomRole(tenant_id=tenant.id, name="Admin",
                            permissions=json.dumps([p.value for p in Permission]), is_default=True)
    agent_role = CustomRole(tenant_id=tenant.id, name="Agent",
                            permissions=json.dumps([
                                Permission.VIEW_ALL_TICKETS.value, Permission.EDIT_TICKETS.value,
                                Permission.MANAGE_KB.value, Permission.VIEW_REPORTS.value,
                                Permission.MANAGE_CANNED.value, Permission.CREATE_CHANGES.value,
                                Permission.APPROVE_CHANGES.value, Permission.MANAGE_ASSETS.value,
                            ]))
    db.add_all([admin_role, agent_role])
    db.flush()

    # Create admin user for tenant if email/password provided
    admin_email = data.get("admin_email", "")
    admin_password = data.get("admin_password", "")
    if admin_email and admin_password:
        if db.query(User).filter(User.email == admin_email).first():
            raise HTTPException(status_code=400, detail="A user with this email already exists")
        new_admin = User(
            email=admin_email,
            hashed_password=get_password_hash(admin_password[:72]),
            full_name=data.get("admin_name", "Admin User"),
            role=UserRole.ADMIN,
            custom_role_id=admin_role.id,
            tenant_id=tenant.id,
            is_active=True,
        )
        db.add(new_admin)

    db.commit()
    db.refresh(tenant)
    return {"id": tenant.id, "name": tenant.name, "slug": tenant.slug, "ok": True}

@app.delete("/superadmin/tenants/{tenant_id}/logo")
def clear_tenant_logo(tenant_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Clear/remove a tenant's logo (super_admin or own tenant admin)."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if admin.role != UserRole.SUPER_ADMIN and admin.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="You can only update your own tenant's logo")
    tenant.logo_url = None
    db.commit()
    return {"ok": True, "message": "Logo cleared."}


@app.post("/superadmin/tenants/{tenant_id}/logo")
async def upload_tenant_logo(tenant_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if admin.role != UserRole.SUPER_ADMIN and admin.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="You can only update your own tenant's logo")
    allowed = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, SVG and WebP images allowed")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB")
    if CLOUDINARY_CLOUD_NAME:
        public_id = f"tenant_{tenant_id}_logo"
        logo_url = upload_to_cloudinary(content, public_id, folder="dodesk/logos")
    else:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        filename = f"tenant_{tenant_id}_logo.{ext}"
        path = os.path.join(LOGO_DIR, filename)
        with open(path, "wb") as f:
            f.write(content)
        logo_url = f"/logos/{filename}"
    tenant.logo_url = logo_url
    db.commit()
    return {"logo_url": logo_url}

@app.patch("/superadmin/tenants/{tenant_id}")
def update_tenant(tenant_id: int, data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if admin.role == UserRole.SUPER_ADMIN:
        allowed_fields = ["name", "support_email", "company_tagline", "primary_color", "accent_color", "is_active", "plan"]
        if "plan" in data and data["plan"] not in PLAN_LIMITS:
            raise HTTPException(status_code=400, detail=f"Invalid plan. Must be one of: {', '.join(PLAN_LIMITS.keys())}")
    elif admin.tenant_id == tenant_id:
        # Regular admins can update their own tenant's branding, but not activate/deactivate or rename
        allowed_fields = ["support_email", "company_tagline", "primary_color", "accent_color"]
    else:
        raise HTTPException(status_code=403, detail="You can only update your own tenant")

    for field in allowed_fields:
        if field in data:
            old_val = getattr(tenant, field, None)
            new_val = data[field]
            if str(old_val) != str(new_val):
                log_system_event(db, admin, f"tenant.{field}.changed",
                                 target_type="tenant", target_id=tenant.id,
                                 target_label=tenant.name,
                                 old_value=str(old_val), new_value=str(new_val))
            setattr(tenant, field, new_val)
    db.commit()
    return {"ok": True}

@app.get("/admin/tenant", response_model=TenantOut)
def get_tenant(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_TENANT):
        raise HTTPException(status_code=403)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    return tenant

# =============================================================================
# CSAT ENDPOINTS
# =============================================================================

@app.get("/csat/{token}")
def get_csat_survey(token: str, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.csat_token == token).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Survey not found")
    return {"id": ticket.id, "title": ticket.title, "rating": ticket.csat_rating, "comment": ticket.csat_comment}

@app.post("/csat/{token}")
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

@app.get("/reports/csat")
def csat_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    results = db.query(Ticket.csat_rating, sa_func.count(Ticket.id)).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.csat_rating.isnot(None)
    ).group_by(Ticket.csat_rating).all()
    distribution = {str(k): v for k, v in results}
    avg = db.query(sa_func.avg(Ticket.csat_rating)).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.csat_rating.isnot(None)
    ).scalar()
    count = sum(distribution.values())
    return {
        "average": round(avg, 2) if avg else None,
        "count": count,
        "distribution": distribution
    }

# =============================================================================
# AI CHATBOT — Enterprise plan only (DodoBot)
# =============================================================================

def _check_enterprise(current_user: User, db: Session):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant or tenant.plan != "enterprise":
        raise HTTPException(
            status_code=403,
            detail="The AI assistant is available on the Enterprise plan. Contact us to upgrade."
        )

def _build_system_prompt(current_user: User, tenant: Tenant) -> str:
    return f"""You are DodoBot, an AI IT support assistant for {tenant.name} powered by DodoDesk.

You help employees and IT staff with:
- Raising and tracking support tickets
- Searching the knowledge base for solutions
- Looking up asset information
- Answering IT policy and procedure questions

Current user: {current_user.full_name} (role: {current_user.role.value})
Company: {tenant.name}

Guidelines:
- Be concise, friendly and professional
- Always confirm ticket details before creating one
- Cite KB article titles when referencing knowledge base content
- Never fabricate ticket IDs or asset data — use tools only
- Format ticket IDs as INC-XXXX or REQ-XXXX
- If you cannot help, suggest the user raise a ticket
"""

CHAT_TOOLS = [
    {
        "name": "search_tickets",
        "description": "Search the user's tickets by keyword. Returns up to 5 matching tickets.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search keyword"}},
            "required": ["query"]
        }
    },
    {
        "name": "get_ticket",
        "description": "Get full details of a specific ticket by its numeric ID.",
        "input_schema": {
            "type": "object",
            "properties": {"ticket_id": {"type": "integer", "description": "Numeric ticket ID"}},
            "required": ["ticket_id"]
        }
    },
    {
        "name": "create_ticket",
        "description": "Create a new support ticket on behalf of the user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title":       {"type": "string", "description": "Short ticket title"},
                "description": {"type": "string", "description": "Full description of the issue"},
                "priority":    {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                "ticket_type": {"type": "string", "enum": ["incident", "service_request"]},
                "category":    {"type": "string", "description": "e.g. Hardware, Software, Network"}
            },
            "required": ["title", "description"]
        }
    },
    {
        "name": "search_kb",
        "description": "Search the knowledge base for articles matching a query.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search keyword"}},
            "required": ["query"]
        }
    },
    {
        "name": "get_asset",
        "description": "Look up details of an IT asset by its numeric ID.",
        "input_schema": {
            "type": "object",
            "properties": {"asset_id": {"type": "integer", "description": "Numeric asset ID"}},
            "required": ["asset_id"]
        }
    }
]

def _execute_tool(tool_name: str, tool_input: dict, current_user: User, db: Session) -> str:
    if tool_name == "search_tickets":
        q = f"%{tool_input.get('query', '')}%"
        tickets = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            (Ticket.title.ilike(q)) | (Ticket.description.ilike(q))
        ).order_by(Ticket.created_at.desc()).limit(5).all()
        if not tickets:
            return f"No tickets found matching '{tool_input.get('query')}'."
        lines = []
        for t in tickets:
            prefix = "INC" if t.ticket_type and "incident" in str(t.ticket_type) else "REQ"
            lines.append(f"{prefix}-{t.id:04d}: {t.title} [{t.status.value}] [{t.priority.value}]")
        return "\n".join(lines)

    elif tool_name == "get_ticket":
        tid = tool_input.get("ticket_id")
        t = db.query(Ticket).filter(Ticket.id == tid, Ticket.tenant_id == current_user.tenant_id).first()
        if not t:
            return f"Ticket #{tid} not found."
        assignee = db.query(User).filter(User.id == t.assigned_to_id).first() if t.assigned_to_id else None
        prefix = "INC" if t.ticket_type and "incident" in str(t.ticket_type) else "REQ"
        return (f"Ticket {prefix}-{t.id:04d}\nTitle: {t.title}\nStatus: {t.status.value}\n"
                f"Priority: {t.priority.value}\nCategory: {t.category or 'Uncategorised'}\n"
                f"Assigned to: {assignee.full_name if assignee else 'Unassigned'}\n"
                f"Description: {t.description[:300]}")

    elif tool_name == "create_ticket":
        new_t = Ticket(
            tenant_id=current_user.tenant_id,
            requester_id=current_user.id,
            title=tool_input.get("title", ""),
            description=tool_input.get("description", ""),
            priority=TicketPriority(tool_input.get("priority", "medium")),
            ticket_type=TicketType(tool_input.get("ticket_type", "service_request")),
            category=tool_input.get("category", "Other"),
            status=TicketStatus.OPEN,
        )
        db.add(new_t)
        db.commit()
        db.refresh(new_t)
        prefix = "INC" if new_t.ticket_type == TicketType.INCIDENT else "REQ"
        return f"Ticket created: {prefix}-{new_t.id:04d} — \"{new_t.title}\""

    elif tool_name == "search_kb":
        q = f"%{tool_input.get('query', '')}%"
        articles = db.query(KBArticle).filter(
            KBArticle.tenant_id == current_user.tenant_id,
            (KBArticle.title.ilike(q)) | (KBArticle.content.ilike(q))
        ).limit(4).all()
        if not articles:
            return f"No knowledge base articles found for '{tool_input.get('query')}'."
        return "\n\n".join([f"**{a.title}**: {(a.content or '')[:200]}..." for a in articles])

    elif tool_name == "get_asset":
        aid = tool_input.get("asset_id")
        a = db.query(Asset).filter(Asset.id == aid, Asset.tenant_id == current_user.tenant_id).first()
        if not a:
            return f"Asset #{aid} not found."
        return (f"Asset: {a.name}\nType: {a.type.value}\nStatus: {a.status.value}\n"
                f"Serial: {a.serial_number or 'N/A'}\nAssigned to: {a.assigned_to_id or 'Unassigned'}")

    return f"Unknown tool: {tool_name}"


def _run_agentic_loop(messages: list, system: str, db: Session, current_user: User):
    """Run the Claude agentic loop. Returns (final_reply, tool_summary)."""
    import urllib.request as _urllib, json as _json
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI chatbot is not configured.")

    loop_messages = list(messages)
    tool_summary = []

    for _ in range(5):  # max 5 tool-call iterations
        payload = _json.dumps({
            "model": ANTHROPIC_MODEL,
            "max_tokens": 1024,
            "system": system,
            "messages": loop_messages,
            "tools": CHAT_TOOLS,
        }).encode()
        req = _urllib.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST"
        )
        with _urllib.urlopen(req) as resp:
            response = _json.loads(resp.read().decode())

        stop_reason = response.get("stop_reason")
        content_blocks = response.get("content", [])

        if stop_reason == "tool_use":
            tool_blocks = [b for b in content_blocks if b.get("type") == "tool_use"]
            tool_results = []
            for tb in tool_blocks:
                result = _execute_tool(tb["name"], tb["input"], current_user, db)
                tool_summary.append(tb["name"])
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tb["id"],
                    "content": result
                })
            loop_messages.append({"role": "assistant", "content": content_blocks})
            loop_messages.append({"role": "user", "content": tool_results})
        else:
            text_parts = [b["text"] for b in content_blocks if b.get("type") == "text" and b.get("text")]
            return "\n".join(text_parts).strip(), tool_summary

    return "I was unable to complete that request. Please try again.", tool_summary


def _get_or_create_session(session_id, current_user: User, first_message: str, db: Session):
    if session_id:
        session = db.query(ChatSession).filter(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
            ChatSession.tenant_id == current_user.tenant_id
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session, False
    title = first_message[:60] + ("..." if len(first_message) > 60 else "")
    session = ChatSession(tenant_id=current_user.tenant_id, user_id=current_user.id, title=title)
    db.add(session)
    db.flush()
    return session, True


def _build_anthropic_history(session_id: int, db: Session) -> list:
    history = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()
    return [{"role": m.role, "content": m.content} for m in history if m.role in ("user", "assistant")]


# ── Session management endpoints ─────────────────────────────────────────

@app.get("/api/chat/sessions")
def list_chat_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_enterprise(current_user, db)
    sessions = db.query(ChatSession).filter(
        ChatSession.tenant_id == current_user.tenant_id,
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).limit(20).all()
    return [{"id": s.id, "title": s.title, "created_at": s.created_at, "updated_at": s.updated_at}
            for s in sessions]

@app.get("/api/chat/sessions/{session_id}")
def get_chat_session(session_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_enterprise(current_user, db)
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id,
        ChatSession.tenant_id == current_user.tenant_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()
    return {
        "id": session.id, "title": session.title,
        "messages": [{"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at}
                     for m in messages]
    }

@app.delete("/api/chat/sessions/{session_id}")
def delete_chat_session(session_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_enterprise(current_user, db)
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id,
        ChatSession.tenant_id == current_user.tenant_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"ok": True}


# ── Non-streaming chat endpoint ───────────────────────────────────────────

@app.post("/api/chat")
def chat(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Non-streaming chat. Body: {message, session_id?}"""
    import json as _json
    _check_enterprise(current_user, db)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    session, _ = _get_or_create_session(data.get("session_id"), current_user, user_message, db)
    db.add(ChatMessage(session_id=session.id, role="user", content=user_message))
    db.flush()

    history = _build_anthropic_history(session.id, db)
    system  = _build_system_prompt(current_user, tenant)
    reply, tool_summary = _run_agentic_loop(history, system, db, current_user)

    db.add(ChatMessage(
        session_id=session.id, role="assistant", content=reply,
        tool_calls=_json.dumps(tool_summary) if tool_summary else None
    ))
    session.updated_at = datetime.utcnow()
    db.commit()

    return {"reply": reply, "session_id": session.id, "session_title": session.title, "tools_used": tool_summary}


# ── SSE Streaming chat endpoint ───────────────────────────────────────────

@app.post("/api/chat/stream")
def chat_stream(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    SSE streaming chat.
    Body: {message, session_id?}
    Yields SSE events:
      data: {"type":"delta","text":"..."}
      data: {"type":"tool","name":"..."}
      data: {"type":"done","session_id":N,"session_title":"...","tools_used":[...]}
      data: {"type":"error","message":"..."}
    """
    import json as _json, urllib.request as _urllib

    _check_enterprise(current_user, db)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI chatbot is not configured.")

    session, _ = _get_or_create_session(data.get("session_id"), current_user, user_message, db)
    db.add(ChatMessage(session_id=session.id, role="user", content=user_message))
    db.flush()
    db.commit()

    session_id  = session.id
    session_title = session.title
    system = _build_system_prompt(current_user, tenant)

    def event_stream():
        import json as _j, urllib.request as _ur
        tool_summary = []
        full_reply   = []
        loop_messages = _build_anthropic_history(session_id, db)

        for iteration in range(5):
            payload = _j.dumps({
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1024,
                "system": system,
                "messages": loop_messages,
                "tools": CHAT_TOOLS,
                "stream": True,
            }).encode()

            req = _ur.Request(
                "https://api.anthropic.com/v1/messages",
                data=payload,
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                method="POST"
            )

            # Accumulate full streamed response
            current_text   = []
            current_tools  = []
            stop_reason    = None
            response_id    = None
            response_content_for_loop = []

            try:
                with _ur.urlopen(req) as resp:
                    for raw_line in resp:
                        line = raw_line.decode("utf-8").strip()
                        if not line or not line.startswith("data:"):
                            continue
                        event_data = line[5:].strip()
                        if event_data == "[DONE]":
                            break
                        try:
                            event = _j.loads(event_data)
                        except Exception:
                            continue

                        etype = event.get("type")

                        if etype == "message_start":
                            response_id = event.get("message", {}).get("id")

                        elif etype == "content_block_start":
                            block = event.get("content_block", {})
                            if block.get("type") == "tool_use":
                                current_tools.append({
                                    "id": block.get("id"),
                                    "name": block.get("name"),
                                    "input_str": ""
                                })
                                # Notify frontend a tool is being called
                                yield f"data: {_j.dumps({'type': 'tool', 'name': block.get('name')})}\n\n"

                        elif etype == "content_block_delta":
                            delta = event.get("delta", {})
                            dtype = delta.get("type")
                            if dtype == "text_delta":
                                chunk = delta.get("text", "")
                                if chunk:
                                    current_text.append(chunk)
                                    full_reply.append(chunk)
                                    # Stream text token to frontend
                                    yield f"data: {_j.dumps({'type': 'delta', 'text': chunk})}\n\n"
                            elif dtype == "input_json_delta":
                                if current_tools:
                                    current_tools[-1]["input_str"] += delta.get("partial_json", "")

                        elif etype == "message_delta":
                            stop_reason = event.get("delta", {}).get("stop_reason")

            except Exception as e:
                yield f"data: {_j.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return

            # Build content blocks for loop continuation
            if current_text:
                response_content_for_loop.append({"type": "text", "text": "".join(current_text)})
            for t in current_tools:
                try:
                    parsed_input = _j.loads(t["input_str"]) if t["input_str"] else {}
                except Exception:
                    parsed_input = {}
                response_content_for_loop.append({
                    "type": "tool_use",
                    "id": t["id"],
                    "name": t["name"],
                    "input": parsed_input
                })

            if stop_reason == "tool_use" and current_tools:
                # Execute tools and continue loop
                tool_results = []
                for t in current_tools:
                    try:
                        parsed_input = _j.loads(t["input_str"]) if t["input_str"] else {}
                    except Exception:
                        parsed_input = {}
                    result = _execute_tool(t["name"], parsed_input, current_user, db)
                    tool_summary.append(t["name"])
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": t["id"],
                        "content": result
                    })
                loop_messages.append({"role": "assistant", "content": response_content_for_loop})
                loop_messages.append({"role": "user", "content": tool_results})
            else:
                # Done — save final reply and close
                break

        # Persist assistant message
        final_text = "".join(full_reply).strip() or "I was unable to complete that request."
        with next(get_db()) as save_db:
            save_db.add(ChatMessage(
                session_id=session_id, role="assistant", content=final_text,
                tool_calls=_j.dumps(tool_summary) if tool_summary else None
            ))
            s = save_db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if s:
                s.updated_at = datetime.utcnow()
            save_db.commit()

        yield f"data: {_j.dumps({'type': 'done', 'session_id': session_id, 'session_title': session_title, 'tools_used': tool_summary})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",       # disables Nginx buffering on Render
            "Connection": "keep-alive",
        }
    )
