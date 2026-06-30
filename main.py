# ====================================================
# Complete ITSM – All Modules + Dark Mode (theme column)
# ====================================================

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, date
import enum
import os
import re
import smtplib

# Sentry error monitoring — initialise before anything else
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    SENTRY_DSN = os.getenv("SENTRY_DSN", "")
    if SENTRY_DSN:
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            traces_sample_rate=0.1,   # 10% of requests traced
            profiles_sample_rate=0.1,
            environment=os.getenv("SENTRY_ENV", "production"),
            send_default_pii=False,   # don't send user PII to Sentry
        )
        print("✅ Sentry initialised")
    else:
        print("ℹ️ SENTRY_DSN not set — error monitoring disabled")
except ImportError:
    print("ℹ️ sentry-sdk not installed — skipping Sentry")
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

from fastapi import FastAPI, Depends, HTTPException, status, Query, Header, UploadFile, File, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, Enum as SAEnum, ForeignKey, Text, Date, Float, UniqueConstraint
import sqlalchemy as sa
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship, backref
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
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_pre_ping=True,         # test connection before use
        pool_recycle=300,           # recycle connections every 5 min (Neon idles at ~5 min)
        pool_size=5,                # keep 5 connections in pool
        max_overflow=10,            # allow 10 extra on burst
        pool_timeout=30,            # wait max 30s for a connection
        connect_args={
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        },
    )
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
    READONLY = "readonly"   # can view everything, create nothing
    EMPLOYEE = "employee"
    AGENT = "agent"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"  # platform owner — sees/manages all tenants

class TicketStatus(str, enum.Enum):
    PENDING_APPROVAL    = "pending_approval"
    OPEN                = "open"
    IN_PROGRESS         = "in_progress"
    PENDING_USER        = "pending_user"      # waiting for requester's input/reply
    PENDING_VENDOR      = "pending_vendor"    # waiting for third-party/vendor
    RESOLVED            = "resolved"
    CLOSED              = "closed"

class TicketPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class TicketType(str, enum.Enum):
    INCIDENT = "incident"
    SERVICE_REQUEST = "service_request"

class AssetType(str, enum.Enum):
    HARDWARE    = "hardware"
    SOFTWARE    = "software"
    NETWORK     = "network"
    MOBILE      = "mobile"
    PERIPHERAL  = "peripheral"
    SAAS        = "saas"
    CLOUD       = "cloud"
    OTHER       = "other"

class AssetStatus(str, enum.Enum):
    AVAILABLE   = "available"
    ASSIGNED    = "assigned"
    MAINTENANCE = "maintenance"
    RETIRED     = "retired"
    DISPOSED    = "disposed"
    LOST        = "lost"
    STOLEN      = "stolen"

class ChangeType(str, enum.Enum):
    NORMAL    = "normal"      # Standard ITIL change requiring CAB approval
    STANDARD  = "standard"    # Pre-approved, low-risk, routine change
    EMERGENCY = "emergency"   # Urgent, bypasses normal CAB cycle

class ChangeRisk(str, enum.Enum):
    LOW    = "low"
    MEDIUM = "medium"
    HIGH   = "high"
    CRITICAL = "critical"

class ChangeStatus(str, enum.Enum):
    DRAFT            = "draft"
    PENDING_APPROVAL = "pending_approval"
    IN_REVIEW        = "in_review"
    APPROVED         = "approved"
    SCHEDULED        = "scheduled"
    IN_PROGRESS      = "in_progress"
    IMPLEMENTED      = "implemented"
    REJECTED         = "rejected"
    CANCELLED        = "cancelled"
    FAILED           = "failed"

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
    custom_css = Column(Text, nullable=True)
    favicon_url = Column(String, nullable=True)
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
    employee_id = Column(String, nullable=True)  # custom employee ID set by admin
    country = Column(String, nullable=True)  # country name
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    status_changed_at = Column(DateTime, nullable=True)  # last time is_active was toggled
    current_session_id = Column(String, nullable=True)  # for single-session enforcement
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String, nullable=True)
    mfa_backup_codes = Column(Text, nullable=True)  # JSON array of unused backup codes
    email_verified = Column(Boolean, default=False)  # must verify email before tenant is activated
    password_reset_token = Column(String, nullable=True)
    password_reset_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    # New profile fields
    phone = Column(String, nullable=True)
    timezone = Column(String, default="UTC")
    availability = Column(String, default="online")    # online | busy | away | offline
    notification_prefs = Column(Text, nullable=True)   # JSON: per-event toggles

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
    group_id = Column(Integer, ForeignKey("groups.id", use_alter=True, name="fk_ticket_group"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    sla_response_deadline = Column(DateTime, nullable=True)
    sla_resolution_deadline = Column(DateTime, nullable=True)
    sla_breach_notified_at = Column(DateTime, nullable=True)
    escalated_at = Column(DateTime, nullable=True)
    first_response_at = Column(DateTime, nullable=True)  # when first agent reply was posted
    tags = Column(Text, nullable=True)  # JSON array of tag strings e.g. ["vpn","network"]
    merged_into_id = Column(Integer, nullable=True)  # if merged, points to primary ticket id
    resolution_note = Column(Text, nullable=True)    # what was done to resolve the ticket
    resolved_at = Column(DateTime, nullable=True)    # when it was resolved
    resolution_kb_article_id = Column(Integer, ForeignKey("kb_articles.id"), nullable=True)  # linked KB article
    csat_token = Column(String, unique=True, nullable=True)
    csat_rating = Column(Integer, nullable=True)
    csat_comment = Column(Text, nullable=True)
    due_date = Column(DateTime, nullable=True)           # manual due date set by agent
    custom_fields_data = Column(Text, nullable=True)     # JSON: {field_key: value, ...}
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
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # nullable for system comments
    body = Column(String, nullable=False)
    is_internal = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())

    ticket = relationship("Ticket", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])

# ── Custom ticket fields ──────────────────────────────────────────────────────
class CustomField(Base):
    """Admin-defined extra fields for tickets, per tenant."""
    __tablename__ = "custom_fields"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)           # e.g. "Customer PO Number"
    field_key = Column(String, nullable=False)       # e.g. "customer_po_number"
    field_type = Column(String, default="text")      # text | number | date | dropdown | checkbox
    options = Column(Text, nullable=True)            # JSON list of options for dropdown
    is_required = Column(Boolean, default=False)
    applies_to = Column(String, default="all")       # all | incident | service_request | change
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())

# ── Macros ───────────────────────────────────────────────────────────────────
class Macro(Base):
    """One-click multi-action sequences for agents."""
    __tablename__ = "macros"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    actions = Column(Text, nullable=False)           # JSON list of actions
    is_shared = Column(Boolean, default=True)        # shared=all agents, False=creator only
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    run_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())
    created_by = relationship("User", foreign_keys=[created_by_id])

# ── Saved ticket views ────────────────────────────────────────────────────────
class TicketView(Base):
    """Saved filter views per agent or shared across team."""
    __tablename__ = "ticket_views"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    filters = Column(Text, nullable=False)           # JSON: {status, priority, assigned, category, tag, ...}
    is_shared = Column(Boolean, default=False)       # False = personal, True = shared with team
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())
    created_by = relationship("User", foreign_keys=[created_by_id])

# ── Ticket tasks ──────────────────────────────────────────────────────────────
class TicketTask(Base):
    """Sub-tasks / checklist items on a ticket."""
    __tablename__ = "ticket_tasks"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    title = Column(String, nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    is_done = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])

# ── Ticket templates ──────────────────────────────────────────────────────────
class TicketTemplate(Base):
    """Pre-filled ticket forms for common request types."""
    __tablename__ = "ticket_templates"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)            # e.g. "VPN Access Request"
    ticket_type = Column(String, default="incident") # incident | service_request | change
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)
    priority = Column(String, default="medium")
    tags = Column(Text, nullable=True)               # JSON array
    created_at = Column(DateTime, server_default=sa_func.now())

# ── Problem tickets ───────────────────────────────────────────────────────────
class ProblemLink(Base):
    """Links multiple incident tickets to a root-cause problem ticket."""
    __tablename__ = "problem_links"
    id = Column(Integer, primary_key=True, index=True)
    problem_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    incident_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)

class KBArticle(Base):
    __tablename__ = "kb_articles"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=True)
    folder = Column(String, nullable=True)           # sub-category / folder within category
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="draft", nullable=False)  # draft | published
    version = Column(Integer, default=1, nullable=False)
    view_count = Column(Integer, default=0, nullable=False)
    helpful_count = Column(Integer, default=0, nullable=False)      # 👍 count
    not_helpful_count = Column(Integer, default=0, nullable=False)  # 👎 count
    tags = Column(Text, nullable=True)               # JSON array of tag strings
    visibility = Column(String, default="all")       # all | agents_only | employees_only
    review_date = Column(DateTime, nullable=True)    # flag for review after this date
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="kb_articles")
    author = relationship("User")
    versions = relationship("KBVersion", back_populates="article", cascade="all, delete-orphan", order_by="KBVersion.version_number.desc()")

class KBVersion(Base):
    """Snapshot of a KB article at each save."""
    __tablename__ = "kb_versions"
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("kb_articles.id"), nullable=False)
    version_number = Column(Integer, nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=True)
    status = Column(String, nullable=True)
    change_note = Column(String, nullable=True)  # optional note about what changed
    edited_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    article = relationship("KBArticle", back_populates="versions")
    edited_by = relationship("User", foreign_keys=[edited_by_id])

class Asset(Base):
    __tablename__ = "assets"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    type = Column(SAEnum(AssetType), nullable=False)
    model = Column(String, nullable=True)                 # e.g. "Dell Latitude 5420" — picked from admin-managed list per type
    serial_number = Column(String, unique=True, nullable=True)
    status = Column(SAEnum(AssetStatus), default=AssetStatus.AVAILABLE)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    purchase_date = Column(DateTime, nullable=True)
    license_key = Column(String, nullable=True)
    vendor = Column(String, nullable=True)
    expiry_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    # New fields
    location = Column(String, nullable=True)              # room, building, site
    purchase_cost = Column(Float, nullable=True)          # for depreciation
    warranty_expiry = Column(Date, nullable=True)         # warranty end date
    contract_number = Column(String, nullable=True)       # PO / contract ref
    quantity = Column(Integer, default=1)                 # for consumables
    seats_total = Column(Integer, nullable=True)          # software: total seats
    seats_used = Column(Integer, default=0)               # software: seats in use
    maintenance_date = Column(DateTime, nullable=True)    # next planned maintenance
    parent_asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)  # asset hierarchy
    tag_number = Column(String, nullable=True)            # asset tag / barcode
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="assets")
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    tickets = relationship("Ticket", back_populates="asset", foreign_keys=[Ticket.asset_id])
    children = relationship("Asset", foreign_keys=[parent_asset_id], backref=backref("parent", remote_side="Asset.id"))

class AssetModelOption(Base):
    """Admin-managed list of model/manufacturer options shown in the asset creation
    dropdown, scoped per asset type (e.g. type=hardware → Dell Latitude 5420, HP EliteBook...)."""
    __tablename__ = "asset_model_options"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    asset_type = Column(SAEnum(AssetType), nullable=False)
    label = Column(String, nullable=False)                # e.g. "Dell Latitude 5420"
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())



class AssetHistory(Base):
    """Tracks every assignment change for an asset."""
    __tablename__ = "asset_history"
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    action = Column(String, nullable=False)  # "assigned", "unassigned", "status_changed"
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    to_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    note = Column(String, nullable=True)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime, server_default=sa_func.now())
    from_user = relationship("User", foreign_keys=[from_user_id])
    to_user = relationship("User", foreign_keys=[to_user_id])
    changed_by = relationship("User", foreign_keys=[changed_by_id])

class TimeEntry(Base):
    """Agent logs time spent on a ticket."""
    __tablename__ = "time_entries"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    minutes = Column(Integer, nullable=False)  # time spent in minutes
    note = Column(String, nullable=True)        # what was done
    logged_at = Column(DateTime, server_default=sa_func.now())
    agent = relationship("User")

class TicketLink(Base):
    """Parent-child relationship between tickets."""
    __tablename__ = "ticket_links"
    id = Column(Integer, primary_key=True, index=True)
    parent_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    child_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)

class Group(Base):
    """Agent groups — tickets can be assigned to a group."""
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")

class GroupMember(Base):
    __tablename__ = "group_members"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group = relationship("Group", back_populates="members")
    user = relationship("User")

class AutomationRule(Base):
    """If/then automation rules — run on ticket events or on a schedule."""
    __tablename__ = "automation_rules"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    trigger = Column(String, nullable=False)   # on_create | on_update | on_status_change | time_based
    # Conditions stored as JSON: [{"field": "priority", "operator": "is", "value": "high"}]
    conditions = Column(Text, nullable=True)
    # Actions stored as JSON: [{"action": "assign_to", "value": "12"}]
    actions = Column(Text, nullable=False)
    run_count = Column(Integer, default=0)
    last_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())

class AdminTenantAccess(Base):
    """Super admin can grant an admin access to manage multiple tenants."""
    __tablename__ = "admin_tenant_access"
    id = Column(Integer, primary_key=True, index=True)
    admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    granted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    granted_at = Column(DateTime, server_default=sa_func.now())
    admin_user = relationship("User", foreign_keys=[admin_user_id])
    tenant = relationship("Tenant")

class CannedResponse(Base):
    __tablename__ = "canned_responses"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=True)          # folder / category
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    visibility = Column(String, default="all")        # all | personal | group
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    use_count = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    author = relationship("User")
    group = relationship("Group", foreign_keys=[group_id])

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
    change_type = Column(String, default="normal")          # normal | standard | emergency
    risk_level = Column(SAEnum(ChangeRisk), default=ChangeRisk.MEDIUM)
    risk_score = Column(Integer, nullable=True)             # 1-25 calculated from impact x likelihood
    status = Column(SAEnum(ChangeStatus), default=ChangeStatus.DRAFT)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)      # change owner (separate from requester)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    planned_date = Column(Date, nullable=True)
    start_date = Column(DateTime, nullable=True)            # implementation start
    end_date = Column(DateTime, nullable=True)              # implementation end
    impact = Column(Text, nullable=True)                    # who/what is affected
    rollback_plan = Column(Text, nullable=True)             # what to do if change fails
    test_plan = Column(Text, nullable=True)                 # how to verify success
    cab_members = Column(Text, nullable=True)               # JSON list of user_ids for CAB
    linked_ticket_ids = Column(Text, nullable=True)         # JSON list of ticket IDs
    linked_asset_ids = Column(Text, nullable=True)          # JSON list of asset IDs
    post_review_notes = Column(Text, nullable=True)         # post-implementation review
    post_review_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=sa_func.now())
    updated_at = Column(DateTime, onupdate=sa_func.now())

    tenant = relationship("Tenant", back_populates="change_requests")
    requester = relationship("User", foreign_keys=[requester_id])
    owner = relationship("User", foreign_keys=[owner_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])

# ── Change tasks ──────────────────────────────────────────────────────────────
class ChangeTask(Base):
    """Sub-tasks / checklist items on a change request."""
    __tablename__ = "change_tasks"
    id = Column(Integer, primary_key=True, index=True)
    change_id = Column(Integer, ForeignKey("change_requests.id"), nullable=False)
    title = Column(String, nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_done = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])

# ── Change comments ───────────────────────────────────────────────────────────
class ChangeComment(Base):
    """Comments / discussion on a change request."""
    __tablename__ = "change_comments"
    id = Column(Integer, primary_key=True, index=True)
    change_id = Column(Integer, ForeignKey("change_requests.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    is_internal = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    author = relationship("User", foreign_keys=[author_id])

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
    is_featured = Column(Boolean, default=False)
    # New features
    sort_order = Column(Integer, default=0)
    icon = Column(String, nullable=True)
    request_form_fields = Column(Text, nullable=True)
    visibility = Column(String, default="all")
    sla_hours = Column(Integer, nullable=True)
    request_count = Column(Integer, default=0)
    fulfillment_checklist = Column(Text, nullable=True)
    approval_workflow_id = Column(Integer, ForeignKey("approval_workflows.id"), nullable=True)
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
    reply_to  = Column(String, default="")
    email_signature = Column(Text, default="")   # appended to all outgoing emails
    email_footer = Column(Text, default="")      # footer text
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

class TicketWatcher(Base):
    __tablename__ = "ticket_watchers"
    id         = Column(Integer, primary_key=True, index=True)
    ticket_id  = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    created_at = Column(DateTime, server_default=sa_func.now())
    __table_args__ = (UniqueConstraint("ticket_id", "user_id", name="uq_ticket_watcher"),)

# =============================================================================

class TicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: TicketPriority = TicketPriority.MEDIUM
    ticket_type: TicketType = TicketType.INCIDENT
    on_behalf_of_id: int | None = None
    tags: list[str] = []
    group_id: int | None = None
    due_date: datetime | None = None
    custom_fields_data: dict | None = None
    template_id: int | None = None  # optional: create from template

class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    assigned_to_id: int | None = None
    priority: TicketPriority | None = None
    category: str | None = None
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    group_id: int | None = None
    resolution_note: str | None = None
    resolution_kb_article_id: int | None = None
    due_date: datetime | None = None
    custom_fields_data: dict | None = None

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
    watchers: list[dict] = []

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
    category: str
    folder: str | None = None
    status: str = "draft"
    tags: list[str] = []
    visibility: str = "all"
    review_date: datetime | None = None

class KBArticleUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None
    folder: str | None = None
    status: str | None = None
    change_note: str | None = None
    tags: list[str] | None = None
    visibility: str | None = None
    review_date: datetime | None = None
    sort_order: int | None = None

class KBArticleOut(BaseModel):
    id: int
    title: str
    content: str
    category: str | None
    folder: str | None = None
    author_id: int
    author_name: str
    status: str = "published"
    version: int = 1
    view_count: int = 0
    helpful_count: int = 0
    not_helpful_count: int = 0
    tags: list[str] = []
    visibility: str = "all"
    review_date: datetime | None = None
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True

class AssetCreate(BaseModel):
    name: str
    type: AssetType
    model: str | None = None
    serial_number: str | None = None
    status: AssetStatus = AssetStatus.AVAILABLE
    assigned_to_id: int | None = None
    purchase_date: datetime | None = None
    license_key: str | None = None
    vendor: str | None = None
    expiry_date: date | None = None
    notes: str | None = None
    location: str | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    contract_number: str | None = None
    quantity: int = 1
    seats_total: int | None = None
    maintenance_date: datetime | None = None
    parent_asset_id: int | None = None
    tag_number: str | None = None

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
    location: str | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    contract_number: str | None = None
    quantity: int | None = None
    seats_total: int | None = None
    seats_used: int | None = None
    maintenance_date: datetime | None = None
    parent_asset_id: int | None = None
    tag_number: str | None = None

class AssetOut(BaseModel):
    id: int
    name: str
    type: AssetType
    model: str | None = None
    serial_number: str | None
    status: AssetStatus
    assigned_to_id: int | None
    assigned_to_name: str | None = None
    purchase_date: datetime | None
    license_key: str | None = None
    vendor: str | None = None
    expiry_date: date | None = None
    notes: str | None
    location: str | None = None
    purchase_cost: float | None = None
    warranty_expiry: date | None = None
    contract_number: str | None = None
    quantity: int = 1
    seats_total: int | None = None
    seats_used: int = 0
    maintenance_date: datetime | None = None
    parent_asset_id: int | None = None
    tag_number: str | None = None
    ticket_count: int = 0
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
    employee_id: str | None = None
    country: str | None = None
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
    employee_id: str | None = None
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
    employee_id: str | None = None
    tenant_id: int | None = None

class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    country: str | None = None
    language: str | None = None
    theme: str | None = None
    job_title: str | None = None
    department: str | None = None
    phone: str | None = None
    timezone: str | None = None
    availability: str | None = None

class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str

class CannedResponseCreate(BaseModel):
    title: str
    content: str
    category: str | None = None
    visibility: str = "all"   # all | personal | group
    group_id: int | None = None
    sort_order: int = 0

class CannedResponseUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None
    visibility: str | None = None
    group_id: int | None = None
    sort_order: int | None = None

class CannedResponseOut(BaseModel):
    id: int
    title: str
    content: str
    category: str | None
    author_id: int
    author_name: str
    visibility: str = "all"
    group_id: int | None = None
    use_count: int = 0
    sort_order: int = 0
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
    change_type: str = "normal"
    risk_level: ChangeRisk = ChangeRisk.MEDIUM
    risk_score: int | None = None
    planned_date: date | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    impact: str | None = None
    rollback_plan: str | None = None
    test_plan: str | None = None
    owner_id: int | None = None
    assigned_to_id: int | None = None
    cab_members: list[int] = []
    linked_ticket_ids: list[int] = []
    linked_asset_ids: list[int] = []

class ChangeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    change_type: str | None = None
    risk_level: ChangeRisk | None = None
    risk_score: int | None = None
    status: ChangeStatus | None = None
    planned_date: date | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    impact: str | None = None
    rollback_plan: str | None = None
    test_plan: str | None = None
    owner_id: int | None = None
    assigned_to_id: int | None = None
    cab_members: list[int] | None = None
    linked_ticket_ids: list[int] | None = None
    linked_asset_ids: list[int] | None = None
    post_review_notes: str | None = None

class ChangeOut(BaseModel):
    id: int
    title: str
    description: str
    change_type: str = "normal"
    risk_level: ChangeRisk
    risk_score: int | None = None
    status: ChangeStatus
    requester_id: int
    requester_name: str = ""
    owner_id: int | None = None
    owner_name: str = ""
    assigned_to_id: int | None = None
    assigned_to_name: str = ""
    planned_date: date | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    impact: str | None = None
    rollback_plan: str | None = None
    test_plan: str | None = None
    cab_members: list[int] = []
    linked_ticket_ids: list[int] = []
    linked_asset_ids: list[int] = []
    post_review_notes: str | None = None
    post_review_at: datetime | None = None
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
import secrets
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
SMTP_FROM = os.getenv("SMTP_FROM", "DodoDesk <noreply@dodobay.com>")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")  # preferred over SMTP on Render
# Canonical verified from address for Resend — must match verified domain
RESEND_FROM = os.getenv("RESEND_FROM", SMTP_FROM or "DodoDesk <noreply@dodobay.com>")

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
            "smtp_from": cfg.smtp_from, "reply_to": cfg.reply_to or "",
            "slack_webhook_url": cfg.slack_webhook_url or "",
            "teams_webhook_url": cfg.teams_webhook_url or "",
        }
    return {
        "smtp_host": SMTP_HOST, "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER, "smtp_pass": SMTP_PASS,
        "smtp_from": SMTP_FROM, "reply_to": cfg.reply_to if cfg else "",
        "slack_webhook_url": os.getenv("SLACK_WEBHOOK_URL", ""),
        "teams_webhook_url": os.getenv("TEAMS_WEBHOOK_URL", ""),
    }

def build_html_email(subject: str, body_text: str, company_name: str = "DodoDesk", primary_color: str = "#4f46e5", cta_url: str = None, cta_label: str = None, logo_url: str = None) -> str:
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

    # Header — white background, logo centered, company name below (industry standard)
    if logo_url:
        header_content = f"""
            <div style='text-align:center;padding:32px 36px 24px;background:#ffffff;border-radius:12px 12px 0 0;'>
              <img src='{logo_url}' alt='{company_name}'
                   style='height:56px;width:auto;object-fit:contain;display:block;margin:0 auto 12px auto;' />
              <p style='margin:0;font-size:22px;font-weight:800;color:#111827;letter-spacing:-0.5px;'>{company_name}</p>
            </div>
            <div style='height:4px;background:{primary_color};'></div>"""
    else:
        header_content = f"""
            <div style='text-align:center;padding:32px 36px 24px;background:#ffffff;border-radius:12px 12px 0 0;'>
              <p style='margin:0;font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.5px;'>{company_name}</p>
            </div>
            <div style='height:4px;background:{primary_color};'></div>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'>
  <table width='100%' cellpadding='0' cellspacing='0' style='background:#f3f4f6;padding:40px 20px;'>
    <tr><td align='center'>
      <table width='600' cellpadding='0' cellspacing='0' style='max-width:600px;width:100%;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);'>
        <!-- Header: white bg, centered logo + name, brand colour strip -->
        <tr>
          <td style='border-radius:12px 12px 0 0;overflow:hidden;'>
            {header_content}
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
    """Send email via Resend API (preferred) or fall back to SMTP."""
    from_addr = (cfg or {}).get("smtp_from") or SMTP_FROM
    reply_to  = (cfg or {}).get("reply_to") or ""  # tenant-configured Reply-To

    # Get tenant branding
    company_name  = "DodoDesk"
    primary_color = "#4f46e5"
    logo_url      = None
    if db:
        try:
            tenant = db.query(Tenant).first()
            if tenant:
                company_name  = tenant.name or company_name
                primary_color = tenant.primary_color or primary_color
                logo_url      = tenant.logo_url
        except: pass

    html_body = build_html_email(subject, body, company_name, primary_color, cta_url, cta_label, logo_url)

    # ── Resend API (works on Render, no port restrictions) ──────────────
    resend_key = (cfg or {}).get("resend_api_key") or RESEND_API_KEY
    print(f"📧 send_email called: to={to} resend_key_prefix={resend_key[:8] if resend_key else 'None'}")
    if resend_key:
        import json as _j, http.client as _hc, ssl as _ssl
        # Always use RESEND_FROM env var for Resend — never tenant smtp_from
        resend_from = RESEND_FROM or "DodoDesk <onboarding@resend.dev>"
        from_addresses = [resend_from, "DodoDesk <onboarding@resend.dev>"]
        for attempt_from in from_addresses:
            try:
                print(f"📧 Trying Resend from={attempt_from}...")
                payload = _j.dumps({
                    "from": attempt_from,
                    "to": [to],
                    "subject": subject,
                    "html": html_body,
                    "text": body,
                    **({"reply_to": [reply_to]} if reply_to else {}),
                }).encode()
                ctx = _ssl.create_default_context()
                conn = _hc.HTTPSConnection("api.resend.com", port=443, timeout=10, context=ctx)
                conn.request("POST", "/emails", body=payload, headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json",
                })
                resp = conn.getresponse()
                resp_body = resp.read().decode()
                print(f"📧 Resend response: status={resp.status} body={resp_body[:200]}")
                if resp.status in (200, 201):
                    result = _j.loads(resp_body)
                    print(f"✅ Email sent via Resend to {to} — id={result.get('id')}")
                    conn.close()
                    return
                else:
                    print(f"❌ Resend {resp.status} (from={attempt_from}): {resp_body[:300]}")
                conn.close()
            except Exception as e:
                print(f"❌ Resend connection error (from={attempt_from}): {type(e).__name__}: {e}")
        print(f"❌ All Resend attempts failed, falling back to SMTP")

    # ── SMTP fallback ────────────────────────────────────────────────────
    host     = (cfg or {}).get("smtp_host") or SMTP_HOST
    port     = (cfg or {}).get("smtp_port") or SMTP_PORT
    user     = (cfg or {}).get("smtp_user") or SMTP_USER
    password = (cfg or {}).get("smtp_pass") or SMTP_PASS

    if not host:
        print(f"\n--- Email (no SMTP or Resend configured) ---")
        print(f"To: {to}\nSubject: {subject}\nBody:\n{body}\n")
        return

    print(f"📧 Sending email via SMTP: to={to} host={host} port={port}")
    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        if int(port) == 465:
            import ssl
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, int(port), context=context, timeout=30) as server:
                if user: server.login(user, password)
                server.send_message(msg)
                print(f"✅ Email sent via SMTP_SSL to {to}")
        else:
            with smtplib.SMTP(host, int(port), timeout=30) as server:
                server.ehlo(); server.starttls(); server.ehlo()
                if user: server.login(user, password)
                server.send_message(msg)
                print(f"✅ Email sent via STARTTLS to {to}")
    except smtplib.SMTPAuthenticationError as e:
        print(f"❌ SMTP Auth failed for {user}: {e}")
    except smtplib.SMTPConnectError as e:
        print(f"❌ SMTP Connect failed to {host}:{port}: {e}")
    except Exception as e:
        print(f"❌ SMTP error to {to}: {type(e).__name__}: {e}")

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

# =============================================================================
# AUTOMATION ENGINE
# =============================================================================

def _evaluate_condition(ticket: "Ticket", cond: dict) -> bool:
    """Evaluate a single condition against a ticket."""
    field = cond.get("field", "")
    operator = cond.get("operator", "is")
    value = str(cond.get("value", "")).lower().strip()

    ticket_val = ""
    if field == "priority":
        ticket_val = ticket.priority.value if ticket.priority else ""
    elif field == "status":
        ticket_val = ticket.status.value if ticket.status else ""
    elif field == "ticket_type":
        ticket_val = ticket.ticket_type.value if ticket.ticket_type else ""
    elif field == "category":
        ticket_val = (ticket.category or "").lower()
    elif field == "tag":
        tags = json.loads(ticket.tags) if ticket.tags else []
        if operator == "contains":
            return value in [t.lower() for t in tags]
        return value in [t.lower() for t in tags]
    elif field == "assigned_to":
        ticket_val = str(ticket.assigned_to_id or "")
    elif field == "group_id":
        ticket_val = str(ticket.group_id or "")
    else:
        return True  # unknown field — skip

    ticket_val = ticket_val.lower()

    if operator == "is":
        return ticket_val == value
    elif operator == "is_not":
        return ticket_val != value
    elif operator == "contains":
        return value in ticket_val
    elif operator == "is_empty":
        return not ticket_val
    elif operator == "is_not_empty":
        return bool(ticket_val)
    return True

def _execute_action(ticket: "Ticket", action_def: dict, db: "Session", tenant_id: int) -> None:
    """Execute a single automation action on a ticket."""
    action = action_def.get("action", "")
    value = action_def.get("value", "")

    if action == "assign_to" and value:
        ticket.assigned_to_id = int(value)
    elif action == "assign_to_group" and value:
        ticket.group_id = int(value)
    elif action == "set_priority" and value:
        try:
            ticket.priority = TicketPriority(value)
        except ValueError:
            pass
    elif action == "set_status" and value:
        try:
            ticket.status = TicketStatus(value)
            if ticket.status == TicketStatus.RESOLVED:
                ticket.resolved_at = ticket.resolved_at or datetime.utcnow()
        except ValueError:
            pass
    elif action == "add_tag" and value:
        existing = json.loads(ticket.tags) if ticket.tags else []
        if value not in existing:
            existing.append(value)
            ticket.tags = json.dumps(existing)
    elif action == "add_comment" and value:
        comment = Comment(ticket_id=ticket.id, author_id=None, body=f"🤖 Automation: {value}", is_internal=True)
        db.add(comment)
    elif action == "close_ticket":
        ticket.status = TicketStatus.CLOSED
        ticket.resolved_at = ticket.resolved_at or datetime.utcnow()

def run_automation_rules(ticket: "Ticket", trigger: str, db: "Session") -> int:
    """
    Evaluate all active automation rules for a tenant against a ticket.
    Returns count of rules that fired.
    """
    try:
        rules = db.query(AutomationRule).filter(
            AutomationRule.tenant_id == ticket.tenant_id,
            AutomationRule.is_active == True,
            AutomationRule.trigger == trigger
        ).all()
        fired = 0
        for rule in rules:
            try:
                conditions = json.loads(rule.conditions) if rule.conditions else []
                actions = json.loads(rule.actions) if rule.actions else []
                # ALL conditions must pass (AND logic)
                if all(_evaluate_condition(ticket, c) for c in conditions):
                    for action_def in actions:
                        _execute_action(ticket, action_def, db, ticket.tenant_id)
                    rule.run_count = (rule.run_count or 0) + 1
                    rule.last_run_at = datetime.utcnow()
                    fired += 1
            except Exception as e:
                print(f"⚠️ Automation rule {rule.id} error: {e}")
        return fired
    except Exception as e:
        print(f"⚠️ run_automation_rules error: {e}")
        return 0

def check_time_based_automations():
    """Runs every 30 minutes. Executes time_based automation rules."""
    try:
        db = SessionLocal()
        rules = db.query(AutomationRule).filter(
            AutomationRule.is_active == True,
            AutomationRule.trigger == "time_based"
        ).all()
        for rule in rules:
            try:
                conditions = json.loads(rule.conditions) if rule.conditions else []
                actions = json.loads(rule.actions) if rule.actions else []
                # For time-based: conditions include hours_since_update, hours_since_created
                query = db.query(Ticket).filter(Ticket.tenant_id == rule.tenant_id,
                                                Ticket.status.notin_([TicketStatus.RESOLVED, TicketStatus.CLOSED]))
                for cond in conditions:
                    if cond.get("field") == "hours_since_update":
                        cutoff = datetime.utcnow() - timedelta(hours=int(cond.get("value", 24)))
                        query = query.filter(Ticket.updated_at < cutoff)
                    elif cond.get("field") == "hours_since_created":
                        cutoff = datetime.utcnow() - timedelta(hours=int(cond.get("value", 48)))
                        query = query.filter(Ticket.created_at < cutoff)
                    elif cond.get("field") == "priority":
                        try:
                            query = query.filter(Ticket.priority == TicketPriority(cond.get("value")))
                        except ValueError:
                            pass
                tickets = query.all()
                for ticket in tickets:
                    for action_def in actions:
                        _execute_action(ticket, action_def, db, rule.tenant_id)
                    rule.run_count = (rule.run_count or 0) + 1
                    rule.last_run_at = datetime.utcnow()
                db.commit()
            except Exception as e:
                print(f"⚠️ Time automation rule {rule.id}: {e}")
    except Exception as e:
        print(f"⚠️ check_time_based_automations: {e}")
    finally:
        try: db.close()
        except: pass

def auto_close_tickets():
    """Runs every hour.
    Auto-closes tickets that are pending_user for 10+ days with no reply.
    Sends a warning comment at day 7 (3 days before close).
    """
    try:
        db = SessionLocal()
        now = datetime.utcnow()
        warning_cutoff = now - timedelta(days=7)
        close_cutoff   = now - timedelta(days=10)

        # Find tickets pending user reply
        pending_tickets = db.query(Ticket).filter(
            Ticket.status == TicketStatus.PENDING_USER,
            Ticket.updated_at < warning_cutoff,
        ).all()

        for ticket in pending_tickets:
            age_days = (now - ticket.updated_at).days

            if age_days >= 10:
                # Auto-close
                ticket.status = TicketStatus.CLOSED
                ticket.updated_at = now
                db.add(Comment(
                    ticket_id=ticket.id,
                    author_id=None,
                    body="🔒 This ticket has been automatically closed after 10 days with no response from the requester. If you still need assistance, please open a new ticket.",
                    is_internal=False,
                ))
                print(f"✅ Auto-closed ticket {ticket.id} (pending_user {age_days} days)")

            elif age_days >= 7:
                # Warning — only send once (check if warning already sent)
                already_warned = db.query(Comment).filter(
                    Comment.ticket_id == ticket.id,
                    Comment.body.like("%will be automatically closed in 3 days%"),
                ).first()
                if not already_warned:
                    db.add(Comment(
                        ticket_id=ticket.id,
                        author_id=None,
                        body="⚠️ We are still waiting for your response on this ticket. If we do not hear back within 3 days, this ticket will be automatically closed. Please reply to keep it open.",
                        is_internal=False,
                    ))
                    print(f"✅ Sent auto-close warning for ticket {ticket.id}")

        db.commit()
    except Exception as e:
        print(f"⚠️ auto_close_tickets: {e}")
    finally:
        try: db.close()
        except: pass

# =============================================================================

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
        'password_reset_token': 'VARCHAR',
        'password_reset_expires_at': 'TIMESTAMP',
        'employee_id': 'VARCHAR',
        'country': 'VARCHAR',
    }

    # Add 'readonly' value to userrole enum if not already present
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'readonly'"))
            conn.commit()
            print("✅ Migration: userrole enum updated with 'readonly'")
        except Exception as e:
            print(f"⚠️ userrole enum migration: {e}")

    # Ticket column migrations
    try:
        with engine.connect() as conn:
            ticket_cols = {col['name'] for col in inspector.get_columns('tickets')}
            ticket_migrations = {
                'first_response_at': 'TIMESTAMP',
                'tags': 'TEXT',
                'merged_into_id': 'INTEGER',
                'sla_breach_notified_at': 'TIMESTAMP',
                'escalated_at': 'TIMESTAMP',
                'resolution_note': 'TEXT',
                'resolved_at': 'TIMESTAMP',
                'resolution_kb_article_id': 'INTEGER',
            }
            for col_name, col_type in ticket_migrations.items():
                if col_name not in ticket_cols:
                    try:
                        conn.execute(text(f'ALTER TABLE tickets ADD COLUMN {col_name} {col_type}'))
                        conn.commit()
                        print(f"✅ Migration: added column tickets.{col_name}")
                    except Exception as e:
                        print(f"⚠️ Migration skipped for tickets.{col_name}: {e}")
    except Exception as e:
        print(f"⚠️ Ticket column migration failed: {e}")

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

    # Ticket new columns (due_date, custom_fields_data)
    try:
        with engine.connect() as conn:
            t_cols = {col['name'] for col in inspector.get_columns('tickets')}
            for col, defn in [('due_date', 'TIMESTAMP'), ('custom_fields_data', 'TEXT')]:
                if col not in t_cols:
                    conn.execute(text(f'ALTER TABLE tickets ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: tickets.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: tickets columns: {e}")

    # Custom fields table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS custom_fields (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    name VARCHAR NOT NULL,
                    field_key VARCHAR NOT NULL,
                    field_type VARCHAR DEFAULT 'text',
                    options TEXT,
                    is_required BOOLEAN DEFAULT FALSE,
                    applies_to VARCHAR DEFAULT 'all',
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: custom_fields table ready")
    except Exception as e:
        print(f"⚠️ Migration: custom_fields: {e}")

    # Macros table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS macros (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    name VARCHAR NOT NULL,
                    description VARCHAR,
                    actions TEXT NOT NULL,
                    is_shared BOOLEAN DEFAULT TRUE,
                    created_by_id INTEGER REFERENCES users(id),
                    run_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: macros table ready")
    except Exception as e:
        print(f"⚠️ Migration: macros: {e}")

    # Ticket views table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_views (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    created_by_id INTEGER NOT NULL REFERENCES users(id),
                    name VARCHAR NOT NULL,
                    filters TEXT NOT NULL,
                    is_shared BOOLEAN DEFAULT FALSE,
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: ticket_views table ready")
    except Exception as e:
        print(f"⚠️ Migration: ticket_views: {e}")

    # Ticket tasks table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_tasks (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    title VARCHAR NOT NULL,
                    assigned_to_id INTEGER REFERENCES users(id),
                    due_date TIMESTAMP,
                    is_done BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: ticket_tasks table ready")
    except Exception as e:
        print(f"⚠️ Migration: ticket_tasks: {e}")

    # Ticket templates table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_templates (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    name VARCHAR NOT NULL,
                    ticket_type VARCHAR DEFAULT 'incident',
                    title VARCHAR,
                    description TEXT,
                    category VARCHAR,
                    priority VARCHAR DEFAULT 'medium',
                    tags TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: ticket_templates table ready")
    except Exception as e:
        print(f"⚠️ Migration: ticket_templates: {e}")

    # User new profile columns
    try:
        with engine.connect() as conn:
            user_cols = {col['name'] for col in inspector.get_columns('users')}
            for col, defn in [
                ('phone',               'VARCHAR'),
                ('timezone',            "VARCHAR DEFAULT 'UTC'"),
                ('availability',        "VARCHAR DEFAULT 'online'"),
                ('notification_prefs',  'TEXT'),
            ]:
                if col not in user_cols:
                    conn.execute(text(f'ALTER TABLE users ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: users.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: users columns: {e}")

    # Tenant new branding columns
    try:
        with engine.connect() as conn:
            tenant_cols = {col['name'] for col in inspector.get_columns('tenants')}
            for col, defn in [
                ('custom_css',   'TEXT'),
                ('favicon_url',  'VARCHAR'),
            ]:
                if col not in tenant_cols:
                    conn.execute(text(f'ALTER TABLE tenants ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: tenants.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: tenants columns: {e}")

    # EmailConfig new columns
    try:
        with engine.connect() as conn:
            ec_cols = {col['name'] for col in inspector.get_columns('email_configs')}
            for col, defn in [
                ('email_signature', 'TEXT DEFAULT \'\''),
                ('email_footer',    'TEXT DEFAULT \'\''),
            ]:
                if col not in ec_cols:
                    conn.execute(text(f'ALTER TABLE email_configs ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: email_configs.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: email_configs columns: {e}")

    # One-time backfill: normalise KB article and Catalog item categories
    # to match the shared TICKET_CATEGORIES list. Blank or non-matching
    # values are set to "Other" so the new Category Focus report groups cleanly.
    try:
        VALID_CATEGORIES = {
            "Hardware", "Software", "Network", "Account", "Email",
            "Security", "Printer", "Mobile Device", "Cloud Services",
            "Telephony", "Other"
        }
        with engine.connect() as conn:
            # KB articles
            kb_rows = conn.execute(text(
                "SELECT id, category FROM kb_articles WHERE category IS NULL OR category = '' "
                "OR category NOT IN :valid"
            ), {"valid": tuple(VALID_CATEGORIES)}).fetchall()
            for row in kb_rows:
                conn.execute(text("UPDATE kb_articles SET category = 'Other' WHERE id = :id"), {"id": row[0]})
            if kb_rows:
                conn.commit()
                print(f"✅ Migration: backfilled {len(kb_rows)} kb_articles.category → 'Other'")

            # Catalog items
            cat_rows = conn.execute(text(
                "SELECT id, category FROM service_catalog_items WHERE category IS NULL OR category = '' "
                "OR category NOT IN :valid"
            ), {"valid": tuple(VALID_CATEGORIES)}).fetchall()
            for row in cat_rows:
                conn.execute(text("UPDATE service_catalog_items SET category = 'Other' WHERE id = :id"), {"id": row[0]})
            if cat_rows:
                conn.commit()
                print(f"✅ Migration: backfilled {len(cat_rows)} service_catalog_items.category → 'Other'")
    except Exception as e:
        print(f"⚠️ Migration: category backfill: {e}")

    # Canned response new columns
    try:
        with engine.connect() as conn:
            cr_cols = {col['name'] for col in inspector.get_columns('canned_responses')}
            for col, defn in [
                ('tenant_id',  'INTEGER'),
                ('visibility', "VARCHAR DEFAULT 'all'"),
                ('group_id',   'INTEGER'),
                ('use_count',  'INTEGER DEFAULT 0'),
                ('sort_order', 'INTEGER DEFAULT 0'),
            ]:
                if col not in cr_cols:
                    conn.execute(text(f'ALTER TABLE canned_responses ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: canned_responses.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: canned_responses columns: {e}")

    # Change request new columns
    try:
        with engine.connect() as conn:
            chg_cols = {col['name'] for col in inspector.get_columns('change_requests')}
            for col, defn in [
                ('change_type',         "VARCHAR DEFAULT 'normal'"),
                ('risk_score',          'INTEGER'),
                ('owner_id',            'INTEGER'),
                ('start_date',          'TIMESTAMP'),
                ('end_date',            'TIMESTAMP'),
                ('impact',              'TEXT'),
                ('rollback_plan',       'TEXT'),
                ('test_plan',           'TEXT'),
                ('cab_members',         'TEXT'),
                ('linked_ticket_ids',   'TEXT'),
                ('linked_asset_ids',    'TEXT'),
                ('post_review_notes',   'TEXT'),
                ('post_review_at',      'TIMESTAMP'),
            ]:
                if col not in chg_cols:
                    conn.execute(text(f'ALTER TABLE change_requests ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: change_requests.{col} added")
            # Migrate default status from pending_approval → draft for new enum
    except Exception as e:
        print(f"⚠️ Migration: change_requests columns: {e}")

    # Change tasks table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS change_tasks (
                    id SERIAL PRIMARY KEY,
                    change_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
                    title VARCHAR NOT NULL,
                    assigned_to_id INTEGER REFERENCES users(id),
                    is_done BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: change_tasks table ready")
    except Exception as e:
        print(f"⚠️ Migration: change_tasks: {e}")

    # Change comments table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS change_comments (
                    id SERIAL PRIMARY KEY,
                    change_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
                    author_id INTEGER NOT NULL REFERENCES users(id),
                    body TEXT NOT NULL,
                    is_internal BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: change_comments table ready")
    except Exception as e:
        print(f"⚠️ Migration: change_comments: {e}")

    # Asset new columns
    try:
        with engine.connect() as conn:
            asset_cols = {col['name'] for col in inspector.get_columns('assets')}
            for col, defn in [
                ('model', 'VARCHAR'),
                ('location', 'VARCHAR'),
                ('purchase_cost', 'FLOAT'),
                ('warranty_expiry', 'DATE'),
                ('contract_number', 'VARCHAR'),
                ('quantity', 'INTEGER DEFAULT 1'),
                ('seats_total', 'INTEGER'),
                ('seats_used', 'INTEGER DEFAULT 0'),
                ('maintenance_date', 'TIMESTAMP'),
                ('parent_asset_id', 'INTEGER'),
                ('tag_number', 'VARCHAR'),
            ]:
                if col not in asset_cols:
                    conn.execute(text(f'ALTER TABLE assets ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: assets.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: assets columns: {e}")

    # Asset model options table — admin-managed dropdown per asset type
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS asset_model_options (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    asset_type VARCHAR NOT NULL,
                    label VARCHAR NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: asset_model_options table ready")

            # Seed sensible defaults for any tenant that has none yet
            DEFAULT_MODEL_OPTIONS = {
                "hardware":   ["Dell Latitude 5420", "Dell OptiPlex 7090", "HP EliteBook 840",
                               "HP ProBook 450", "Lenovo ThinkPad T14", "Lenovo ThinkCentre M70q",
                               "Apple MacBook Pro 14\"", "Apple MacBook Air M2", "Apple iMac 24\""],
                "software":   ["Microsoft Office 365", "Adobe Creative Cloud", "Windows 11 Pro",
                               "AutoCAD", "Slack", "Zoom"],
                "network":    ["Cisco Catalyst 2960", "Ubiquiti UniFi Switch", "TP-Link Switch",
                               "Fortinet FortiGate", "Netgear Router"],
                "mobile":     ["Apple iPhone 14", "Apple iPhone 15", "Samsung Galaxy S23",
                               "Samsung Galaxy A54", "Google Pixel 8"],
                "peripheral": ["Dell UltraSharp Monitor", "HP LaserJet Printer", "Logitech MX Keys",
                               "Logitech MX Master Mouse", "Jabra Headset"],
                "saas":       ["Salesforce", "HubSpot", "Google Workspace", "DodoDesk", "Notion"],
                "cloud":      ["AWS EC2 Instance", "Azure VM", "Google Cloud Compute", "DigitalOcean Droplet"],
                "other":      ["Other / Custom"],
            }
            tenant_ids = [row[0] for row in conn.execute(text("SELECT id FROM tenants")).fetchall()]
            for tid in tenant_ids:
                existing = conn.execute(text(
                    "SELECT COUNT(*) FROM asset_model_options WHERE tenant_id = :tid"
                ), {"tid": tid}).scalar()
                if existing == 0:
                    for asset_type, labels in DEFAULT_MODEL_OPTIONS.items():
                        for i, label in enumerate(labels):
                            conn.execute(text(
                                "INSERT INTO asset_model_options (tenant_id, asset_type, label, sort_order) "
                                "VALUES (:tid, :atype, :label, :sort)"
                            ), {"tid": tid, "atype": asset_type, "label": label, "sort": i})
                    conn.commit()
                    print(f"✅ Migration: seeded default asset model options for tenant {tid}")
    except Exception as e:
        print(f"⚠️ Migration: asset_model_options: {e}")

    # Service catalog new columns
    try:
        with engine.connect() as conn:
            cat_cols = {col['name'] for col in inspector.get_columns('service_catalog_items')}
            for col, defn in [
                ('sort_order', 'INTEGER DEFAULT 0'),
                ('icon', 'VARCHAR'),
                ('request_form_fields', 'TEXT'),
                ('visibility', "VARCHAR DEFAULT 'all'"),
                ('sla_hours', 'INTEGER'),
                ('request_count', 'INTEGER DEFAULT 0'),
                ('fulfillment_checklist', 'TEXT'),
                ('approval_workflow_id', 'INTEGER'),
            ]:
                if col not in cat_cols:
                    conn.execute(text(f'ALTER TABLE service_catalog_items ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: service_catalog_items.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: service_catalog_items: {e}")

    # Problem links table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS problem_links (
                    id SERIAL PRIMARY KEY,
                    problem_ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    incident_ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
                )
            """))
            conn.commit()
            print("✅ Migration: problem_links table ready")
    except Exception as e:
        print(f"⚠️ Migration: problem_links: {e}")

    # email_configs reply_to column
    try:
        with engine.connect() as conn:
            cols = {col['name'] for col in inspector.get_columns('email_configs')}
            if 'reply_to' not in cols:
                conn.execute(text("ALTER TABLE email_configs ADD COLUMN reply_to VARCHAR DEFAULT ''"))
                conn.commit()
                print("✅ Migration: email_configs.reply_to added")
    except Exception as e:
        print(f"⚠️ Migration: email_configs.reply_to: {e}")

    # KB article new columns (status, version, view_count + new features)
    try:
        with engine.connect() as conn:
            kb_cols = {col['name'] for col in inspector.get_columns('kb_articles')}
            for col, defn in [
                ('status', "VARCHAR DEFAULT 'published'"),
                ('version', 'INTEGER DEFAULT 1'),
                ('view_count', 'INTEGER DEFAULT 0'),
                ('helpful_count', 'INTEGER DEFAULT 0'),
                ('not_helpful_count', 'INTEGER DEFAULT 0'),
                ('tags', 'TEXT'),
                ('folder', 'VARCHAR'),
                ('visibility', "VARCHAR DEFAULT 'all'"),
                ('review_date', 'TIMESTAMP'),
                ('sort_order', 'INTEGER DEFAULT 0'),
            ]:
                if col not in kb_cols:
                    conn.execute(text(f'ALTER TABLE kb_articles ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: added kb_articles.{col}")
    except Exception as e:
        print(f"⚠️ Migration: kb_articles columns: {e}")

    # KB versions table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS kb_versions (
                    id SERIAL PRIMARY KEY,
                    article_id INTEGER NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
                    version_number INTEGER NOT NULL,
                    title VARCHAR NOT NULL,
                    content TEXT NOT NULL,
                    category VARCHAR,
                    status VARCHAR,
                    change_note VARCHAR,
                    edited_by_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: kb_versions table ready")
    except Exception as e:
        print(f"⚠️ Migration: kb_versions: {e}")

    # Automation rules table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS automation_rules (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    name VARCHAR NOT NULL,
                    description VARCHAR,
                    is_active BOOLEAN DEFAULT TRUE,
                    trigger VARCHAR NOT NULL,
                    conditions TEXT,
                    actions TEXT NOT NULL,
                    run_count INTEGER DEFAULT 0,
                    last_run_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: automation_rules table ready")
    except Exception as e:
        print(f"⚠️ Migration: automation_rules: {e}")

    # Admin multi-tenant access table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS admin_tenant_access (
                    id SERIAL PRIMARY KEY,
                    admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    granted_by_id INTEGER REFERENCES users(id),
                    granted_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(admin_user_id, tenant_id)
                )
            """))
            conn.commit()
            print("✅ Migration: admin_tenant_access table ready")
    except Exception as e:
        print(f"⚠️ Migration: admin_tenant_access: {e}")

    # Asset history table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS asset_history (
                    id SERIAL PRIMARY KEY,
                    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                    action VARCHAR NOT NULL,
                    from_user_id INTEGER REFERENCES users(id),
                    to_user_id INTEGER REFERENCES users(id),
                    note VARCHAR,
                    changed_by_id INTEGER REFERENCES users(id),
                    changed_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: asset_history table ready")
    except Exception as e:
        print(f"⚠️ Migration: asset_history: {e}")

    # Time entries table
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS time_entries (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    agent_id INTEGER NOT NULL REFERENCES users(id),
                    minutes INTEGER NOT NULL,
                    note VARCHAR,
                    logged_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
            print("✅ Migration: time_entries table ready")
    except Exception as e:
        print(f"⚠️ Migration: time_entries: {e}")

    # Ticket links table (parent-child)
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_links (
                    id SERIAL PRIMARY KEY,
                    parent_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    child_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    UNIQUE(parent_id, child_id)
                )
            """))
            conn.commit()
            print("✅ Migration: ticket_links table ready")
    except Exception as e:
        print(f"⚠️ Migration: ticket_links: {e}")

    # Groups and group members tables
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS groups (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    name VARCHAR NOT NULL,
                    description VARCHAR,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS group_members (
                    id SERIAL PRIMARY KEY,
                    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
                )
            """))
            # Add group_id to tickets after groups table exists
            try:
                conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id)"))
            except Exception:
                pass
            conn.commit()
            print("✅ Migration: groups tables ready")
    except Exception as e:
        print(f"⚠️ Migration: groups: {e}")

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

    # Ticket watchers
    try:
        existing_tables = inspector.get_table_names()
        if "ticket_watchers" not in existing_tables:
            with engine.connect() as conn:
                conn.execute(text("""CREATE TABLE ticket_watchers (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_ticket_watcher UNIQUE (ticket_id, user_id)
                )"""))
                conn.commit()
                print("✅ Migration: ticket_watchers table created")
    except Exception as e:
        print(f"⚠️ Migration: ticket_watchers: {e}")

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
    import threading, asyncio
    os.makedirs(AVATAR_DIR, exist_ok=True)
    Base.metadata.create_all(bind=engine)

    # Run migrations in a thread with timeout to avoid Render startup timeout
    migration_done = threading.Event()
    def _run_migrations_safe():
        try:
            run_migrations()
        except Exception as e:
            print(f"⚠️ Migration error (non-fatal): {e}")
        finally:
            migration_done.set()

    mig_thread = threading.Thread(target=_run_migrations_safe, daemon=True)
    mig_thread.start()
    mig_thread.join(timeout=20)  # max 20s for migrations
    if not migration_done.is_set():
        print("⚠️ Migrations taking too long — continuing startup anyway")

    seed()

    # Start schedulers after a short delay so the server is live first
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_sla_breaches, 'interval', minutes=5, id='sla_breach_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=60))
    scheduler.add_job(check_escalations, 'interval', minutes=10, id='escalation_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=90))
    scheduler.add_job(check_time_based_automations, 'interval', minutes=30, id='automation_time_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=120))
    scheduler.add_job(auto_close_tickets, 'interval', hours=1, id='auto_close_check',
                      next_run_time=datetime.utcnow() + timedelta(seconds=150))
    scheduler.start()
    print("✅ SLA breach + escalation + automation + auto-close schedulers started")

    yield

    scheduler.shutdown()
    print("SLA breach scheduler stopped")

app = FastAPI(lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
# Support multiple comma-separated origins e.g. "https://app.vercel.app,http://localhost:5173"
_allowed_origins = list(set(
    [o.strip() for o in ALLOWED_ORIGIN.split(",") if o.strip()]
    + ["http://localhost:5173", "http://localhost:3000"]
))
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure CORS headers are present even on 500 errors
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

class CORSOnErrorMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        origin = request.headers.get("origin", "")
        is_allowed = origin in _allowed_origins

        # Handle OPTIONS preflight directly — don't pass to app
        if request.method == "OPTIONS":
            from starlette.responses import Response as _R
            r = _R(status_code=204)
            if is_allowed:
                r.headers["Access-Control-Allow-Origin"]      = origin
                r.headers["Access-Control-Allow-Credentials"] = "true"
                r.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
                r.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization, X-Requested-With"
                r.headers["Access-Control-Max-Age"]           = "86400"
            return r

        try:
            response = await call_next(request)
        except Exception:
            from starlette.responses import JSONResponse
            response = JSONResponse({"detail": "Internal server error"}, status_code=500)

        if is_allowed:
            response.headers["Access-Control-Allow-Origin"]      = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

app.add_middleware(CORSOnErrorMiddleware)

# =============================================================================
# DEPENDENCIES
# =============================================================================

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass  # SSL already closed — ignore rollback failure
        raise
    finally:
        try:
            db.close()
        except Exception:
            pass  # SSL already closed — ignore close failure

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
    # Readonly — can view tickets/assets/kb/reports but cannot create or edit anything
    if user.role == UserRole.READONLY:
        return permission in [
            Permission.VIEW_ALL_TICKETS,
            Permission.VIEW_REPORTS,
        ]
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
    from sqlalchemy import text as _text
    email = data.get("email", "").lower().strip()
    user = db.query(User).filter(User.email == email, User.is_active == True).first()
    if not user:
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
        print(f"✅ Reset token stored for {user.email}, expires {expires_at}")
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

    def _send():
        import json as _j, http.client as _hc, ssl as _ssl
        subject  = "🔑 Password Reset — DodoDesk"
        body_txt = (
            f"Hi {_name},\n\n"
            f"You requested a password reset. Click the link below:\n\n"
            f"{_url}\n\n"
            f"This link expires in 1 hour. If you did not request this, ignore this email."
        )
        html_body = build_html_email(subject, body_txt, _cname, _color, _url, "Reset My Password", _logo)

        for from_addr in [_from, "DodoDesk <onboarding@resend.dev>"]:
            try:
                payload = _j.dumps({
                    "from": from_addr, "to": [_email],
                    "subject": subject, "html": html_body, "text": body_txt,
                }).encode()
                ctx  = _ssl.create_default_context()
                conn = _hc.HTTPSConnection("api.resend.com", port=443, timeout=10, context=ctx)
                conn.request("POST", "/emails", body=payload, headers={
                    "Authorization": f"Bearer {_key}",
                    "Content-Type": "application/json",
                })
                resp      = conn.getresponse()
                resp_body = resp.read().decode()
                conn.close()
                if resp.status in (200, 201):
                    print(f"✅ Reset email sent via Resend to {_email} (from={from_addr})")
                    return
                print(f"⚠️ Resend {resp.status} from={from_addr}: {resp_body[:200]}")
            except Exception as e:
                print(f"⚠️ Resend error from={from_addr}: {e}")

        # Last resort SMTP fallback
        print(f"📧 SMTP fallback for reset email to {_email}")
        send_email(_email, subject, body_txt, cta_url=_url, cta_label="Reset My Password")

    threading.Thread(target=_send, daemon=True).start()
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}

@app.post("/auth/reset-password")
def reset_password(data: dict, db: Session = Depends(get_db)):
    import traceback
    from sqlalchemy import text as _text
    token        = data.get("token", "")
    new_password = data.get("new_password", "")
    print(f"🔑 reset_password called token_len={len(token)} pw_len={len(new_password)}")

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")

    reset_val = f"reset_{token}"

    try:
        # Step 1 — ensure column exists
        try:
            with db.bind.connect() as conn:
                conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR"))
                conn.commit()
        except Exception as e:
            print(f"⚠️ ALTER TABLE skipped: {e}")

        # Step 2 — look up token and check expiry
        with db.bind.connect() as conn:
            result = conn.execute(
                _text("SELECT id, password_reset_expires_at FROM users WHERE password_reset_token = :tok"),
                {"tok": reset_val}
            ).fetchone()
        print(f"🔍 Token lookup result: {result}")

        if not result:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token. Please request a new one.")

        user_id = result[0]
        expires_at = result[1]

        # Check expiry — reject if token is older than 1 hour
        if expires_at and datetime.utcnow() > expires_at:
            # Clear the expired token
            with db.bind.connect() as conn:
                conn.execute(_text("UPDATE users SET password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = :uid"), {"uid": user_id})
                conn.commit()
            raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new password reset.")

        # Step 3 — validate and hash
        validate_password_strength(new_password)
        hashed = get_password_hash(new_password[:72])

        # Step 4 — update and clear token + expiry
        with db.bind.connect() as conn:
            conn.execute(
                _text("UPDATE users SET hashed_password = :pw, password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = :uid"),
                {"pw": hashed, "uid": user_id}
            )
            conn.commit()

        print(f"✅ Password reset successful for user_id={user_id}")
        return {"ok": True, "message": "Password reset successfully. You can now log in."}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ reset_password error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")

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
    import secrets
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
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.is_active:
            raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in or use a different email.")
        else:
            # Account exists but is unverified — delete it and allow re-signup
            # This lets users retry signup if they never verified their email
            old_tenant = db.query(Tenant).filter(Tenant.id == existing_user.tenant_id, Tenant.is_active == False).first()
            db.query(SignupVerification).filter(SignupVerification.user_id == existing_user.id).delete()
            db.delete(existing_user)
            if old_tenant:
                db.delete(old_tenant)
            db.commit()

    # Validate password strength
    validate_password_strength(password)

    # Generate unique slug
    base_slug = slugify(company_name)
    slug = unique_slug(db, base_slug)

    try:
        # Inherit brand color from super admin tenant for consistency
        super_tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        default_color  = super_tenant.primary_color if super_tenant and super_tenant.primary_color else "#4f46e5"
        default_accent = super_tenant.accent_color if super_tenant and super_tenant.accent_color else "#818cf8"

        # Create tenant (inactive until email verified)
        tenant = Tenant(
            name=company_name,
            slug=slug,
            is_active=False,
            plan="free",
            primary_color=default_color,
            accent_color=default_accent,
        )
        db.add(tenant)
        db.flush()

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

        # Create verification token
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

    def _send_verify_email():
        print(f"📧 [thread] Starting verification email to {_to}, RESEND_API_KEY set={bool(RESEND_API_KEY)}")
        try:
            send_email(
                to=_to,
                subject="Verify your DodoDesk account",
                body=f"Hi {_full_name},\n\nWelcome to DodoDesk! Please verify your email address to activate your account for {_company_name}.\n\nThis link expires in 24 hours.",
                cta_url=_verify_url,
                cta_label="Verify Email",
            )
        except Exception as e:
            print(f"⚠️ Failed to send verification email: {e}")

    import threading
    print(f"📧 [signup] Launching email thread for {_to}")
    threading.Thread(target=_send_verify_email, daemon=True).start()

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
    return [{
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role.value,
        "is_active": u.is_active,
        "job_title": u.job_title,
        "department": u.department,
        "profile_photo": u.profile_photo,
        "availability": u.availability or "online",
        "created_at": u.created_at,
    } for u in users]

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

    # If template_id provided, pre-fill from template
    if ticket.template_id:
        tmpl = db.query(TicketTemplate).filter(
            TicketTemplate.id == ticket.template_id,
            TicketTemplate.tenant_id == current_user.tenant_id
        ).first()
        if tmpl:
            if not ticket.title and tmpl.title:
                ticket.title = tmpl.title
            if not ticket.description and tmpl.description:
                ticket.description = tmpl.description
            if not ticket.category and tmpl.category:
                ticket.category = tmpl.category

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
        tags=json.dumps(ticket.tags) if ticket.tags else None,
        group_id=ticket.group_id,
        due_date=ticket.due_date,
        custom_fields_data=json.dumps(ticket.custom_fields_data) if ticket.custom_fields_data else None,
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

    # Run on_create automation rules
    try:
        run_automation_rules(db_ticket, "on_create", db)
        db.commit()
    except Exception as e:
        print(f"⚠️ on_create automation error: {e}")

    return _ticket_to_out(db_ticket, db)

@app.get("/tickets/")
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
    resolved_after: str | None = Query(None, description="Resolved tickets updated after this ISO datetime"),
    updated_after: str | None = Query(None, description="Tickets updated after this ISO datetime"),
    due_date_from: str | None = Query(None, description="Tickets with due_date >= this ISO datetime"),
    due_date_to: str | None = Query(None, description="Tickets with due_date < this ISO datetime"),
    sort_by: str | None = Query(None),
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

    if tag:
        query = query.filter(Ticket.tags.ilike(f'%"{tag}"%'))

    if group_id:
        query = query.filter(Ticket.group_id == group_id)

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
    return {"items": [_ticket_to_out(t, db) for t in tickets], "total": total, "skip": skip, "limit": limit}

@app.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _ticket_to_out(ticket, db)

@app.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: int, update: TicketUpdate,
                  background_tasks: BackgroundTasks,
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
        # Set resolved_at timestamp when resolved
        if update_data["status"] == TicketStatus.RESOLVED:
            ticket.resolved_at = ticket.resolved_at or datetime.utcnow()
        elif update_data["status"] in [TicketStatus.OPEN, TicketStatus.IN_PROGRESS]:
            ticket.resolved_at = None  # clear if reopened via status change
        # --- CSAT trigger on RESOLVED ---
        if update_data["status"] == TicketStatus.RESOLVED and not ticket.csat_token:
            ticket.csat_token = uuid.uuid4().hex
            requester = db.query(User).filter(User.id == ticket.requester_id).first()
            if requester:
                survey_url = f"{FRONTEND_URL}/csat/{ticket.csat_token}"
                _email = requester.email
                _name  = requester.full_name
                _title = ticket.title
                _url   = survey_url
                print(f"📧 Queuing CSAT email to {_email} for ticket {ticket.id}")
                background_tasks.add_task(
                    send_email, _email,
                    f"✅ Your ticket has been resolved: {_title}",
                    f"Hi {_name},\n\nYour ticket \"{_title}\" has been resolved.\n"
                    f"Please take a moment to rate our service:\n{_url}\n\nThank you!",
                    None, _url, "Rate our service"
                )

        # --- Status change notification for ALL other statuses ---
        elif update_data["status"] in [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.CLOSED]:
            requester = db.query(User).filter(User.id == ticket.requester_id).first()
            if requester and requester.id != current_user.id:
                status_labels = {
                    TicketStatus.OPEN:        "🔓 Open",
                    TicketStatus.IN_PROGRESS: "🔄 In Progress",
                    TicketStatus.CLOSED:      "🔒 Closed",
                }
                status_label = status_labels.get(update_data["status"], str(update_data["status"]))
                prefix = "INC" if ticket.ticket_type == TicketType.INCIDENT else "REQ"
                ticket_ref = f"{prefix}-{ticket.id:04d}"
                _email = requester.email
                _name  = requester.full_name
                _title = ticket.title
                _url   = f"{FRONTEND_URL}/tickets/{ticket.id}"
                print(f"📧 Queuing status email to {_email} — {ticket_ref} → {status_label}")
                background_tasks.add_task(
                    send_email, _email,
                    f"[{ticket_ref}] Status updated: {status_label}",
                    f"Hi {_name},\n\n"
                    f"The status of your ticket has been updated.\n\n"
                    f"Ticket: {ticket_ref}\n"
                    f"Title: {_title}\n"
                    f"New Status: {status_label}\n"
                    f"Updated by: {current_user.full_name}\n\n"
                    f"View your ticket: {_url}\n\nThank you.",
                    None, _url, "View Ticket"
                )
        # --- end status emails ---
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
    if "tags" in update_data:
        old_tags = json.loads(ticket.tags) if ticket.tags else []
        new_tags = update_data["tags"] or []
        ticket.tags = json.dumps(new_tags)
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="tags_updated", field="tags",
                         old_value=",".join(old_tags), new_value=",".join(new_tags))
    if "group_id" in update_data:
        ticket.group_id = update_data["group_id"]
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="group_assigned", field="group_id",
                         new_value=str(update_data["group_id"]) if update_data["group_id"] else "unassigned")
    if "resolution_note" in update_data and update_data["resolution_note"] is not None:
        ticket.resolution_note = update_data["resolution_note"]
        log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                         action="resolution_added", note="Resolution note updated")
    if "resolution_kb_article_id" in update_data:
        ticket.resolution_kb_article_id = update_data["resolution_kb_article_id"]
        if update_data["resolution_kb_article_id"]:
            log_ticket_event(db, ticket.id, ticket.tenant_id, current_user.id,
                             action="kb_linked", note=f"KB article #{update_data['resolution_kb_article_id']} linked as resolution")
    if "due_date" in update_data:
        ticket.due_date = update_data["due_date"]
    if "custom_fields_data" in update_data and update_data["custom_fields_data"] is not None:
        ticket.custom_fields_data = json.dumps(update_data["custom_fields_data"])
    db.commit()
    db.refresh(ticket)
    # Run on_update and on_status_change automation rules
    try:
        run_automation_rules(ticket, "on_update", db)
        if "status" in update_data:
            run_automation_rules(ticket, "on_status_change", db)
        db.commit()
    except Exception as e:
        print(f"⚠️ on_update automation error: {e}")
    # Notify watchers on status change (in background to avoid blocking)
    if "status" in update_data:
        status_label = update_data["status"].value if hasattr(update_data["status"], "value") else str(update_data["status"])
        import threading
        threading.Thread(
            target=_notify_watchers,
            args=(ticket, f"Status changed to {status_label}", current_user, db),
            kwargs={"exclude_user_id": current_user.id},
            daemon=True
        ).start()
    return _ticket_to_out(ticket, db)

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
    return _ticket_to_out(ticket, db)

def _ticket_to_out(ticket: Ticket, db: Session = None) -> dict:
    requester = ticket.requester
    assigned = ticket.assigned_to if ticket.assigned_to_id else None
    watchers = []
    if db:
        watcher_rows = db.query(TicketWatcher, User).join(
            User, TicketWatcher.user_id == User.id
        ).filter(TicketWatcher.ticket_id == ticket.id).all()
        watchers = [{"user_id": w.user_id, "full_name": u.full_name, "email": u.email}
                    for w, u in watcher_rows]
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

# =============================================================================
# COLLISION DETECTION — track who is currently viewing a ticket
# =============================================================================
_ticket_viewers = {}  # in-memory presence store: { ticket_id: { user_id: {...} } }

@app.post("/tickets/{ticket_id}/presence")
def update_presence(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called every 15s by the frontend to register/refresh presence on a ticket."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.delete("/tickets/{ticket_id}/presence")
def remove_presence(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called when agent leaves the ticket page."""
    if ticket_id in _ticket_viewers:
        _ticket_viewers[ticket_id].pop(current_user.id, None)
    return {"ok": True}

@app.post("/tickets/{ticket_id}/merge")
def merge_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Merge ticket_id INTO primary_ticket_id. Moves comments/attachments, closes duplicate."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    primary_id = data.get("primary_ticket_id")
    if not primary_id:
        raise HTTPException(status_code=400, detail="primary_ticket_id is required")
    if primary_id == ticket_id:
        raise HTTPException(status_code=400, detail="Cannot merge a ticket into itself")

    duplicate = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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
    duplicate.status = TicketStatus.CLOSED
    duplicate.merged_into_id = primary_id
    log_ticket_event(db, ticket_id, duplicate.tenant_id, current_user.id,
                     action="merged", note=f"Merged into #{primary_id}")
    log_ticket_event(db, primary_id, primary.tenant_id, current_user.id,
                     action="merge_received", note=f"Received merge from #{ticket_id}")
    db.commit()
    return {"ok": True, "primary_id": primary_id, "merged_id": ticket_id}

# =============================================================================
# TIME TRACKING
# =============================================================================

@app.get("/tickets/{ticket_id}/time-entries")
def list_time_entries(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.post("/tickets/{ticket_id}/time-entries")
def log_time(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.delete("/tickets/{ticket_id}/time-entries/{entry_id}")
def delete_time_entry(ticket_id: int, entry_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id, TimeEntry.ticket_id == ticket_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.agent_id != current_user.id and not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Can only delete your own time entries")
    db.delete(entry)
    db.commit()
    return {"ok": True}

# =============================================================================
# PARENT-CHILD TICKET LINKING
# =============================================================================

@app.get("/tickets/{ticket_id}/links")
def get_ticket_links(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Children of this ticket
    children = db.query(TicketLink).filter(TicketLink.parent_id == ticket_id).all()
    # Parent of this ticket
    parent_link = db.query(TicketLink).filter(TicketLink.child_id == ticket_id).first()

    def ticket_summary(t_id):
        t = db.query(Ticket).filter(Ticket.id == t_id).first()
        if not t: return None
        return {"id": t.id, "title": t.title, "status": t.status.value if t.status else "", "ticket_type": t.ticket_type.value if t.ticket_type else ""}

    return {
        "parent": ticket_summary(parent_link.parent_id) if parent_link else None,
        "children": [ticket_summary(c.child_id) for c in children if ticket_summary(c.child_id)],
    }

@app.post("/tickets/{ticket_id}/links")
def link_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    child_id = data.get("child_id")
    if not child_id:
        raise HTTPException(status_code=400, detail="child_id is required")
    if int(child_id) == ticket_id:
        raise HTTPException(status_code=400, detail="A ticket cannot be its own child")
    # Verify both tickets belong to this tenant
    parent = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.delete("/tickets/{ticket_id}/links/{child_id}")
def unlink_ticket(ticket_id: int, child_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    link = db.query(TicketLink).filter(TicketLink.parent_id == ticket_id, TicketLink.child_id == child_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"ok": True}


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
    return _ticket_to_out(ticket, db)

# ---------- Ticket Watchers ----------

def _notify_watchers(ticket: Ticket, event: str, actor: User, db: Session, exclude_user_id: int = None):
    """Send email notifications to all watchers of a ticket."""
    watchers = db.query(TicketWatcher).filter(TicketWatcher.ticket_id == ticket.id).all()
    prefix = "INC" if ticket.ticket_type == TicketType.INCIDENT else "REQ"
    ticket_ref = f"{prefix}-{ticket.id:04d}"
    for w in watchers:
        if w.user_id == exclude_user_id:
            continue
        watcher_user = db.query(User).filter(User.id == w.user_id).first()
        if watcher_user:
            send_email(
                watcher_user.email,
                f"[Watching] {ticket_ref}: {ticket.title} — {event}",
                f"Hi {watcher_user.full_name},\n\n"
                f"An update on a ticket you're watching:\n\n"
                f"Ticket: {ticket_ref} — {ticket.title}\n"
                f"Update: {event}\n"
                f"By: {actor.full_name}\n\n"
                f"View ticket: {FRONTEND_URL}/tickets/{ticket.id}\n\n"
                f"To stop watching this ticket, open it and click 'Unwatch'."
            )

@app.get("/tickets/{ticket_id}/watchers")
def get_watchers(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all watchers for a ticket."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    rows = db.query(TicketWatcher, User).join(User, TicketWatcher.user_id == User.id).filter(
        TicketWatcher.ticket_id == ticket_id
    ).all()
    return [{"user_id": w.user_id, "full_name": u.full_name, "email": u.email} for w, u in rows]

@app.post("/tickets/{ticket_id}/watch")
def watch_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Add current user as a watcher."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.delete("/tickets/{ticket_id}/watch")
def unwatch_ticket(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove current user as a watcher."""
    watcher = db.query(TicketWatcher).filter(
        TicketWatcher.ticket_id == ticket_id, TicketWatcher.user_id == current_user.id
    ).first()
    if watcher:
        db.delete(watcher)
        db.commit()
    return {"ok": True, "watching": False}

@app.post("/tickets/{ticket_id}/watchers/add")
def add_watcher(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Agent/admin adds another user as a watcher."""
    if not has_permission(current_user, Permission.EDIT_TICKETS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.delete("/tickets/{ticket_id}/watchers/{user_id}")
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
    return _ticket_to_out(ticket, db)

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
    return _ticket_to_out(ticket, db)

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

    # Track first response time — set when an agent/admin posts the first non-internal reply
    if not is_internal and has_permission(current_user, Permission.EDIT_TICKETS):
        if not ticket.first_response_at and ticket.requester_id != current_user.id:
            ticket.first_response_at = datetime.utcnow()
            log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                             action="first_response", note=f"First response by {current_user.full_name}")

    db.commit()
    db.refresh(db_comment)
    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                     action="internal_note_added" if is_internal else "comment_added",
                     note=f'{comment.body[:120]}{"..." if len(comment.body) > 120 else ""}')
    db.commit()

    # Process @mentions — notify mentioned agents
    if is_internal and "@" in comment.body:
        process_mentions(comment.body, ticket_id, current_user.tenant_id, current_user, db)
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
        # Notify watchers in background
        import threading
        threading.Thread(
            target=_notify_watchers,
            args=(ticket, f"New comment by {current_user.full_name}: {comment.body[:80]}{'...' if len(comment.body) > 80 else ''}", current_user, db),
            kwargs={"exclude_user_id": current_user.id},
            daemon=True
        ).start()
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
        query = query.filter(KBArticle.tags.ilike(f'%"{tag}"%'))
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

@app.get("/kb/articles/{article_id}/versions")
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

@app.post("/kb/articles/{article_id}/restore/{version_id}")
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

@app.get("/kb/articles/{article_id}", response_model=KBArticleOut)
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
            "created_at": article.created_at, "updated_at": article.updated_at}

@app.post("/kb/articles/", response_model=KBArticleOut)
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
            "created_at": db_article.created_at, "updated_at": db_article.updated_at}

@app.post("/tickets/{ticket_id}/create-kb-article")
def create_kb_from_ticket(ticket_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a KB article pre-filled from ticket resolution note. Links it back to the ticket."""
    if not has_permission(current_user, Permission.MANAGE_KB):
        raise HTTPException(status_code=403, detail="Agents and admins only")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.put("/kb/articles/{article_id}", response_model=KBArticleOut)
def update_kb_article(article_id: int, article: KBArticleUpdate,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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

@app.post("/kb/articles/{article_id}/feedback")
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

@app.get("/kb/categories")
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

@app.get("/kb/articles/{article_id}/related")
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

@app.get("/kb/insights")
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
    return {
        "id": a.id, "name": a.name, "type": a.type, "model": a.model, "serial_number": a.serial_number,
        "status": a.status, "assigned_to_id": a.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": a.purchase_date, "license_key": a.license_key,
        "vendor": a.vendor, "expiry_date": a.expiry_date, "notes": a.notes,
        "location": a.location, "purchase_cost": a.purchase_cost,
        "warranty_expiry": a.warranty_expiry, "contract_number": a.contract_number,
        "quantity": a.quantity or 1, "seats_total": a.seats_total,
        "seats_used": a.seats_used or 0, "maintenance_date": a.maintenance_date,
        "parent_asset_id": a.parent_asset_id, "tag_number": a.tag_number,
        "ticket_count": ticket_count,
        "created_at": a.created_at, "updated_at": a.updated_at,
    }

@app.get("/assets/")
def list_assets(search: str | None = Query(None), skip: int = Query(0, ge=0),
                limit: int = Query(20, ge=1, le=200),
                asset_type: str | None = Query(None),
                status: str | None = Query(None),
                location: str | None = Query(None),
                db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    query = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id)
    if search:
        term = f"%{search}%"
        query = query.filter(
            Asset.name.ilike(term) | Asset.serial_number.ilike(term) |
            Asset.vendor.ilike(term) | Asset.tag_number.ilike(term) |
            Asset.location.ilike(term)
        )
    if asset_type:
        query = query.filter(Asset.type == asset_type)
    if status:
        query = query.filter(Asset.status == status)
    if location:
        query = query.filter(Asset.location.ilike(f"%{location}%"))
    total = query.count()
    assets = query.order_by(Asset.name).offset(skip).limit(limit).all()
    return {"items": [_asset_to_out(a, db) for a in assets], "total": total, "skip": skip, "limit": limit}

@app.get("/assets/expiring", response_model=list[AssetOut])
def expiring_assets(days: int = Query(30), db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Returns assets whose license OR warranty expires within the given window —
    covers both software/SaaS (expiry_date) and hardware (warranty_expiry)."""
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

@app.get("/asset-model-options/")
def list_asset_model_options(asset_type: str | None = Query(None),
                              db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    """Returns admin-managed model/manufacturer options, optionally filtered to one asset type.
    Used to populate the Model dropdown when creating/editing an asset."""
    query = db.query(AssetModelOption).filter(AssetModelOption.tenant_id == current_user.tenant_id)
    if asset_type:
        query = query.filter(AssetModelOption.asset_type == asset_type)
    options = query.order_by(AssetModelOption.asset_type, AssetModelOption.sort_order, AssetModelOption.label).all()
    return [{"id": o.id, "asset_type": o.asset_type, "label": o.label, "sort_order": o.sort_order} for o in options]

@app.post("/asset-model-options/")
def create_asset_model_option(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_permission(current_user, Permission.MANAGE_SETTINGS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    label = (data.get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=422, detail="Label is required")
    asset_type = data.get("asset_type")
    if asset_type not in [t.value for t in AssetType]:
        raise HTTPException(status_code=422, detail="Invalid asset_type")
    option = AssetModelOption(
        tenant_id=current_user.tenant_id, asset_type=asset_type,
        label=label, sort_order=data.get("sort_order", 0)
    )
    db.add(option)
    db.commit()
    db.refresh(option)
    return {"id": option.id, "asset_type": option.asset_type, "label": option.label, "sort_order": option.sort_order}

@app.delete("/asset-model-options/{option_id}")
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
        "id": db_asset.id, "name": db_asset.name, "type": db_asset.type, "model": db_asset.model, "serial_number": db_asset.serial_number,
        "tag_number": db_asset.tag_number,
        "status": db_asset.status, "assigned_to_id": db_asset.assigned_to_id,
        "assigned_to_name": assigned.full_name if assigned else None,
        "purchase_date": db_asset.purchase_date, "purchase_cost": db_asset.purchase_cost,
        "location": db_asset.location,
        "license_key": db_asset.license_key, "vendor": db_asset.vendor, "expiry_date": db_asset.expiry_date,
        "warranty_expiry": db_asset.warranty_expiry,
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
    # Track assignment changes
    if "assigned_to_id" in update_data and update_data["assigned_to_id"] != db_asset.assigned_to_id:
        db.add(AssetHistory(asset_id=asset_id,
            action="assigned" if update_data["assigned_to_id"] else "unassigned",
            from_user_id=db_asset.assigned_to_id, to_user_id=update_data["assigned_to_id"],
            changed_by_id=current_user.id))
    if "status" in update_data and update_data["status"] != db_asset.status:
        db.add(AssetHistory(asset_id=asset_id, action="status_changed",
            note=f"{db_asset.status.value if db_asset.status else '?'} → {update_data['status'].value if hasattr(update_data['status'], 'value') else update_data['status']}",
            changed_by_id=current_user.id))
    for field, value in update_data.items():
        setattr(db_asset, field, value)
    db.commit()
    db.refresh(db_asset)
    return _asset_to_out(db_asset, db)

@app.get("/assets/{asset_id}/history")
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

@app.get("/assets/insights/summary")
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
        t = a.type.value if a.type else "other"
        s = a.status.value if a.status else "unknown"
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

@app.post("/assets/bulk-import")
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
                asset_type = AssetType(raw_type)
            except ValueError:
                asset_type = AssetType.HARDWARE
            db_asset = Asset(
                tenant_id=current_user.tenant_id,
                name=name, type=asset_type,
                serial_number=row.get("serial_number") or None,
                vendor=row.get("vendor") or None,
                location=row.get("location") or None,
                notes=row.get("notes") or None,
                tag_number=row.get("tag_number") or None,
                purchase_cost=float(row["purchase_cost"]) if row.get("purchase_cost") else None,
                status=AssetStatus(row.get("status", "available").lower()) if row.get("status") else AssetStatus.AVAILABLE,
            )
            db.add(db_asset)
            created += 1
        except Exception as e:
            errors.append(f"Row {i+1}: {str(e)}")
    db.commit()
    return {"created": created, "errors": errors}

@app.post("/assets/bulk-action")
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
            asset.status = AssetStatus.RETIRED
        elif action == "maintenance":
            asset.status = AssetStatus.MAINTENANCE
        elif action == "available":
            asset.status = AssetStatus.AVAILABLE
            asset.assigned_to_id = None
        elif action == "assign" and value:
            asset.assigned_to_id = int(value)
            asset.status = AssetStatus.ASSIGNED
            db.add(AssetHistory(asset_id=asset_id, action="assigned",
                                to_user_id=int(value), changed_by_id=current_user.id))
        updated += 1
    db.commit()
    return {"updated": updated}

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

    # Average first response time (hours)
    avg_first_response_hours = 0
    try:
        responded = base_query.filter(Ticket.first_response_at.isnot(None)).all()
        if responded:
            hrs = sum(
                (t.first_response_at - t.created_at).total_seconds() / 3600
                for t in responded if t.first_response_at and t.created_at
            )
            avg_first_response_hours = round(hrs / len(responded), 1)
    except Exception:
        avg_first_response_hours = 0

    return {
        "total": total,
        "open": open_count,
        "overdue": overdue_count,
        "resolved_today": resolved_today,
        "avg_resolution_hours": avg_resolution_hours,
        "avg_first_response_hours": avg_first_response_hours,
        "open_changes": db.query(ChangeRequest).filter(
            ChangeRequest.tenant_id == current_user.tenant_id,
            ChangeRequest.status.in_([ChangeStatus.PENDING_APPROVAL, ChangeStatus.APPROVED])
        ).count(),
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

@app.get("/reports/my-stats")
def my_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Personal stats for the current agent: assigned, due today, overdue, resolved this week."""
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end   = today_start + timedelta(days=1)
    week_start  = today_start - timedelta(days=today_start.weekday())
    now         = datetime.utcnow()
    base = db.query(Ticket).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.assigned_to_id == current_user.id
    )
    assigned_open = base.filter(Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_APPROVAL])).count()
    due_today = base.filter(
        Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS]),
        (
            (Ticket.due_date >= today_start) & (Ticket.due_date < today_end)
        ) | (
            (Ticket.sla_resolution_deadline >= today_start) & (Ticket.sla_resolution_deadline < today_end)
        )
    ).count()
    overdue_mine = base.filter(
        Ticket.sla_resolution_deadline < now,
        Ticket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS])
    ).count()
    resolved_week = base.filter(
        Ticket.status == TicketStatus.RESOLVED,
        Ticket.updated_at >= week_start
    ).count()
    # Avg resolution time this week
    resolved_tix = base.filter(
        Ticket.status == TicketStatus.RESOLVED,
        Ticket.updated_at >= week_start,
        Ticket.updated_at.isnot(None)
    ).with_entities(Ticket.created_at, Ticket.updated_at).all()
    avg_res = 0
    if resolved_tix:
        avg_res = round(sum((t.updated_at - t.created_at).total_seconds() / 3600 for t in resolved_tix if t.updated_at and t.created_at) / len(resolved_tix), 1)
    return {
        "assigned_open": assigned_open,
        "due_today": due_today,
        "overdue_mine": overdue_mine,
        "resolved_week": resolved_week,
        "avg_resolution_hours": avg_res,
    }

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
        # Total time logged by this agent
        time_entries = db.query(TimeEntry).filter(
            TimeEntry.agent_id == agent.id,
            TimeEntry.ticket_id.in_([t.id for t in base.all()])
        ).all()
        total_minutes = sum(e.minutes for e in time_entries)
        result.append({
            "agent_name": agent.full_name,
            "assigned": assigned,
            "resolved": resolved,
            "total_hours": round(total_minutes / 60, 1),
        })
    return result

@app.get("/reports/changes-summary")
def changes_summary(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Summary stats for change requests."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    q = db.query(ChangeRequest).filter(ChangeRequest.tenant_id == current_user.tenant_id)
    if start_date:
        q = q.filter(ChangeRequest.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        q = q.filter(ChangeRequest.created_at <= datetime.combine(end_date, datetime.max.time()))
    total = q.count()
    # By status
    by_status = {}
    for row in q.with_entities(ChangeRequest.status, sa_func.count()).group_by(ChangeRequest.status).all():
        by_status[str(row[0].value) if row[0] else 'unknown'] = row[1]
    # By risk
    by_risk = {}
    for row in q.with_entities(ChangeRequest.risk_level, sa_func.count()).group_by(ChangeRequest.risk_level).all():
        by_risk[str(row[0].value) if row[0] else 'unknown'] = row[1]
    # Daily trend (last 30 days)
    from sqlalchemy import cast, Date as SADate
    daily = []
    try:
        rows = (q.with_entities(cast(ChangeRequest.created_at, SADate).label('day'), sa_func.count())
                  .group_by(cast(ChangeRequest.created_at, SADate))
                  .order_by(cast(ChangeRequest.created_at, SADate)).all())
        daily = [{"date": str(r[0]), "count": r[1]} for r in rows]
    except Exception:
        pass
    # Open count
    open_statuses = [ChangeStatus.PENDING_APPROVAL, ChangeStatus.APPROVED]
    open_count = q.filter(ChangeRequest.status.in_(open_statuses)).count()
    implemented = by_status.get('implemented', 0)
    rejected    = by_status.get('rejected', 0)
    return {
        "total": total,
        "open": open_count,
        "implemented": implemented,
        "rejected": rejected,
        "by_status": by_status,
        "by_risk": by_risk,
        "daily": daily,
    }


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
        changes = query.order_by(ChangeRequest.id).all()
        req_ids = {c.requester_id for c in changes if c.requester_id}
        req_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(req_ids)).all()} if req_ids else {}
        for c in changes:
            try:
                writer.writerow([
                    f"CHG-{c.id:04d}", "change_request", c.title or "",
                    getattr(c, 'category', '') or "",
                    c.risk_level.value if c.risk_level else "",
                    c.status.value if c.status else "",
                    req_map.get(c.requester_id, ""),
                    "", c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "", ""
                ])
            except Exception:
                continue
    else:
        # Export tickets (incidents and/or service requests)
        query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
        query = apply_filters(query, ticket_type, start_date, end_date)
        tickets = query.order_by(Ticket.id).all()
        # Pre-load users to avoid lazy loading issues
        user_ids = set()
        for t in tickets:
            if t.requester_id: user_ids.add(t.requester_id)
            if t.assigned_to_id: user_ids.add(t.assigned_to_id)
        user_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

        for t in tickets:
            if t.ticket_type == TicketType.INCIDENT:
                ticket_ref = f"INC-{t.id:04d}"
            elif t.ticket_type == TicketType.SERVICE_REQUEST:
                ticket_ref = f"REQ-{t.id:04d}"
            else:
                ticket_ref = f"CHG-{t.id:04d}"
            try:
                writer.writerow([
                    ticket_ref,
                    t.ticket_type.value if t.ticket_type else "",
                    t.title or "",
                    t.category or "",
                    t.priority.value if t.priority else "",
                    t.status.value if t.status else "",
                    user_map.get(t.requester_id, ""),
                    user_map.get(t.assigned_to_id, "Unassigned"),
                    t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
                    compute_sla_status(t)
                ])
            except Exception:
                continue

    csv_content = output.getvalue()
    output.close()
    from fastapi.responses import Response
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dodesk_export.csv"}
    )

@app.get("/reports/tickets-by-category")
def tickets_by_category(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Category breakdown with volume, open count, and avg resolution time —
    used to identify which categories need the most operational focus."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    base = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
    base = apply_filters(base, ticket_type, start_date, end_date)
    tickets = base.all()

    by_cat = {}
    for t in tickets:
        cat = t.category or "Uncategorised"
        if cat not in by_cat:
            by_cat[cat] = {"category": cat, "count": 0, "open": 0, "overdue": 0, "res_hours": [], "critical": 0}
        entry = by_cat[cat]
        entry["count"] += 1
        if t.status in (TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_APPROVAL):
            entry["open"] += 1
            if t.sla_resolution_deadline and t.sla_resolution_deadline < datetime.utcnow():
                entry["overdue"] += 1
        if t.priority == TicketPriority.CRITICAL:
            entry["critical"] += 1
        if t.status == TicketStatus.RESOLVED and t.updated_at and t.created_at:
            entry["res_hours"].append((t.updated_at - t.created_at).total_seconds() / 3600)

    results = []
    for cat, e in by_cat.items():
        avg_res = round(sum(e["res_hours"]) / len(e["res_hours"]), 1) if e["res_hours"] else None
        # Focus score: weighted combination of volume, overdue count, and critical tickets
        # Higher score = needs more attention
        focus_score = e["count"] + (e["overdue"] * 3) + (e["critical"] * 2)
        results.append({
            "category": cat,
            "count": e["count"],
            "open": e["open"],
            "overdue": e["overdue"],
            "critical": e["critical"],
            "avg_resolution_hours": avg_res,
            "focus_score": focus_score,
        })

    results.sort(key=lambda r: r["focus_score"], reverse=True)
    return results

@app.get("/reports/resolution-time-trend")
def resolution_time_trend(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Average resolution time per day over the selected period."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    from sqlalchemy import cast, Date as SADate
    query = db.query(
        cast(Ticket.updated_at, SADate).label("day"),
        sa_func.avg(
            sa_func.extract("epoch", Ticket.updated_at - Ticket.created_at) / 3600
        ).label("avg_hours")
    ).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.status == TicketStatus.RESOLVED,
        Ticket.updated_at.isnot(None)
    )
    query = apply_filters(query, ticket_type, start_date, end_date)
    results = query.group_by(cast(Ticket.updated_at, SADate)).order_by(cast(Ticket.updated_at, SADate)).all()
    return [{"date": str(r.day), "avg_hours": round(float(r.avg_hours or 0), 1)} for r in results]

@app.get("/reports/first-response-trend")
def first_response_trend(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Average first response time per day over the selected period."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    from sqlalchemy import cast, Date as SADate
    query = db.query(
        cast(Ticket.created_at, SADate).label("day"),
        sa_func.avg(
            sa_func.extract("epoch", Ticket.first_response_at - Ticket.created_at) / 3600
        ).label("avg_hours")
    ).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.first_response_at.isnot(None)
    )
    query = apply_filters(query, ticket_type, start_date, end_date)
    results = query.group_by(cast(Ticket.created_at, SADate)).order_by(cast(Ticket.created_at, SADate)).all()
    return [{"date": str(r.day), "avg_hours": round(float(r.avg_hours or 0), 1)} for r in results]

@app.get("/reports/tickets-aging")
def tickets_aging(
    ticket_type: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Open tickets bucketed by age: <1d, 1-3d, 3-7d, 7-30d, >30d."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    now = datetime.utcnow()
    open_statuses = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_APPROVAL]
    query = db.query(Ticket).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.status.in_(open_statuses)
    )
    if ticket_type:
        try: query = query.filter(Ticket.ticket_type == TicketType(ticket_type))
        except ValueError: pass
    tickets = query.all()
    buckets = {"<1 day": 0, "1-3 days": 0, "3-7 days": 0, "7-30 days": 0, ">30 days": 0}
    for t in tickets:
        if not t.created_at: continue
        age = (now - t.created_at).days
        if age < 1:   buckets["<1 day"] += 1
        elif age < 3:  buckets["1-3 days"] += 1
        elif age < 7:  buckets["3-7 days"] += 1
        elif age < 30: buckets["7-30 days"] += 1
        else:          buckets[">30 days"] += 1
    return [{"bucket": k, "count": v} for k, v in buckets.items()]

@app.get("/reports/csat-trend")
def csat_trend(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """CSAT average score per day over the selected period."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    from sqlalchemy import cast, Date as SADate
    query = db.query(
        cast(Ticket.updated_at, SADate).label("day"),
        sa_func.avg(Ticket.csat_rating).label("avg_rating"),
        sa_func.count(Ticket.id).label("count")
    ).filter(
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.csat_rating.isnot(None)
    )
    if start_date:
        query = query.filter(Ticket.updated_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.filter(Ticket.updated_at <= datetime.combine(end_date, datetime.max.time()))
    results = query.group_by(cast(Ticket.updated_at, SADate)).order_by(cast(Ticket.updated_at, SADate)).all()
    return [{"date": str(r.day), "avg_rating": round(float(r.avg_rating or 0), 2), "count": r.count} for r in results]

@app.get("/reports/kb-analytics")
def kb_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """KB article analytics — views, feedback, by category."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    articles = db.query(KBArticle).filter(
        KBArticle.tenant_id == current_user.tenant_id,
        KBArticle.status == "published"
    ).all()
    total_views = sum(a.view_count or 0 for a in articles)
    total_helpful = sum(a.helpful_count or 0 for a in articles)
    total_not_helpful = sum(a.not_helpful_count or 0 for a in articles)
    by_category = {}
    for a in articles:
        cat = a.category or "General"
        if cat not in by_category:
            by_category[cat] = {"articles": 0, "views": 0}
        by_category[cat]["articles"] += 1
        by_category[cat]["views"] += a.view_count or 0
    most_viewed = sorted(articles, key=lambda a: a.view_count or 0, reverse=True)[:10]
    return {
        "total_articles": len(articles),
        "total_views": total_views,
        "total_helpful": total_helpful,
        "total_not_helpful": total_not_helpful,
        "satisfaction_rate": round(total_helpful / max(total_helpful + total_not_helpful, 1) * 100, 1),
        "by_category": [{"category": k, **v} for k, v in by_category.items()],
        "most_viewed": [{"id": a.id, "title": a.title, "category": a.category, "views": a.view_count or 0, "helpful": a.helpful_count or 0} for a in most_viewed],
    }

@app.get("/reports/asset-summary")
def asset_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Asset report — by type, status, expiry alerts."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    assets = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id).all()
    today = date.today()
    by_type = {}
    by_status = {}
    for a in assets:
        t = a.type.value if a.type else "other"
        s = a.status.value if a.status else "unknown"
        by_type[t] = by_type.get(t, 0) + 1
        by_status[s] = by_status.get(s, 0) + 1
    expiring_30 = [a for a in assets if a.expiry_date and 0 <= (a.expiry_date - today).days <= 30]
    return {
        "total": len(assets),
        "by_type": [{"type": k, "count": v} for k, v in by_type.items()],
        "by_status": [{"status": k, "count": v} for k, v in by_status.items()],
        "expiring_30_days": len(expiring_30),
        "expiring_soon": [{"id": a.id, "name": a.name, "expiry_date": str(a.expiry_date)} for a in expiring_30[:10]],
        "total_cost": round(sum(a.purchase_cost or 0 for a in assets), 2),
    }

@app.get("/reports/export/excel")
def export_excel(
    ticket_type: str | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Export tickets as Excel file."""
    if not has_permission(current_user, Permission.VIEW_REPORTS):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Tickets"
    headers = ["ID", "Type", "Title", "Category", "Priority", "Status", "Requester", "Assigned To", "Created", "SLA Deadline", "Resolution Time (hrs)"]
    header_fill = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
    query = apply_filters(query, ticket_type, start_date, end_date)
    tickets = query.order_by(Ticket.id).all()
    req_ids = {t.requester_id for t in tickets if t.requester_id}
    asgn_ids = {t.assigned_to_id for t in tickets if t.assigned_to_id}
    all_ids = req_ids | asgn_ids
    user_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(all_ids)).all()} if all_ids else {}
    for row, t in enumerate(tickets, 2):
        prefix = {"incident": "INC", "service_request": "REQ", "change": "CHG"}.get(t.ticket_type.value if t.ticket_type else "incident", "INC")
        res_hours = ""
        if t.status == TicketStatus.RESOLVED and t.updated_at and t.created_at:
            res_hours = round((t.updated_at - t.created_at).total_seconds() / 3600, 1)
        ws.append([
            f"{prefix}{t.id:06d}",
            t.ticket_type.value if t.ticket_type else "",
            t.title or "",
            t.category or "",
            t.priority.value if t.priority else "",
            t.status.value if t.status else "",
            user_map.get(t.requester_id, ""),
            user_map.get(t.assigned_to_id, ""),
            t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
            str(t.sla_resolution_deadline.date()) if t.sla_resolution_deadline else "",
            res_hours,
        ])
    # Auto-size columns
    for col in ws.columns:
        max_len = max((len(str(cell.value or "")) for cell in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=dodesk_tickets.xlsx"}
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
        status=ChangeStatus.DRAFT
    )
    db.add(db_change)
    db.commit()
    db.refresh(db_change)
    return _change_to_out(db_change, db=db)

@app.get("/changes/")
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

@app.get("/changes/{change_id}", response_model=ChangeOut)
def get_change(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and change.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _change_to_out(change, db=db)

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
        "change_type": change.change_type or "normal",
        "risk_level": change.risk_level,
        "risk_score": change.risk_score,
        "status": change.status,
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

# =============================================================================
# CHANGE TASKS
# =============================================================================

@app.get("/changes/{change_id}/tasks")
def list_change_tasks(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    tasks = db.query(ChangeTask).filter(ChangeTask.change_id == change_id).order_by(ChangeTask.created_at).all()
    return [{"id": t.id, "title": t.title, "is_done": t.is_done,
             "assigned_to_id": t.assigned_to_id,
             "assigned_to_name": t.assigned_to.full_name if t.assigned_to else None,
             "created_at": t.created_at} for t in tasks]

@app.post("/changes/{change_id}/tasks")
def create_change_task(change_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    task = ChangeTask(change_id=change_id, title=data.get("title", "New Task"),
                      assigned_to_id=data.get("assigned_to_id"))
    db.add(task); db.commit(); db.refresh(task)
    return {"id": task.id, "title": task.title, "is_done": task.is_done}

@app.patch("/changes/{change_id}/tasks/{task_id}")
def update_change_task(change_id: int, task_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(ChangeTask).filter(ChangeTask.id == task_id, ChangeTask.change_id == change_id).first()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    for k in ["title", "is_done", "assigned_to_id"]:
        if k in data: setattr(task, k, data[k])
    db.commit()
    return {"ok": True}

@app.delete("/changes/{change_id}/tasks/{task_id}")
def delete_change_task(change_id: int, task_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(ChangeTask).filter(ChangeTask.id == task_id, ChangeTask.change_id == change_id).first()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task); db.commit()
    return {"ok": True}

# =============================================================================
# CHANGE COMMENTS
# =============================================================================

@app.get("/changes/{change_id}/comments")
def list_change_comments(change_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    comments = db.query(ChangeComment).filter(ChangeComment.change_id == change_id).order_by(ChangeComment.created_at).all()
    return [{"id": c.id, "body": c.body, "is_internal": c.is_internal,
             "author_id": c.author_id,
             "author_name": c.author.full_name if c.author else "Unknown",
             "created_at": c.created_at} for c in comments]

@app.post("/changes/{change_id}/comments")
def add_change_comment(change_id: int, data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    change = db.query(ChangeRequest).filter(ChangeRequest.id == change_id, ChangeRequest.tenant_id == current_user.tenant_id).first()
    if not change: raise HTTPException(status_code=404, detail="Change not found")
    comment = ChangeComment(change_id=change_id, author_id=current_user.id,
                            body=data.get("body", ""), is_internal=data.get("is_internal", False))
    db.add(comment); db.commit(); db.refresh(comment)
    return {"id": comment.id, "body": comment.body, "created_at": comment.created_at}

# =============================================================================
# CHANGE CALENDAR
# =============================================================================

@app.get("/changes/calendar")
def get_change_calendar(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns all changes with dates for calendar view."""
    if not has_permission(current_user, Permission.APPROVE_CHANGES) and not has_permission(current_user, Permission.CREATE_CHANGES):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    changes = db.query(ChangeRequest).filter(
        ChangeRequest.tenant_id == current_user.tenant_id,
        (ChangeRequest.planned_date != None) | (ChangeRequest.start_date != None)
    ).order_by(ChangeRequest.planned_date).all()
    return [{"id": c.id, "title": c.title, "change_type": c.change_type or "normal",
             "risk_level": c.risk_level.value if c.risk_level else "medium",
             "status": c.status.value if c.status else "draft",
             "planned_date": c.planned_date, "start_date": c.start_date, "end_date": c.end_date}
            for c in changes]

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
            "smtp_from": SMTP_FROM, "reply_to": "",
            "slack_webhook_url": SLACK_WEBHOOK_URL,
            "teams_webhook_url": TEAMS_WEBHOOK_URL,
            "email_signature": "", "email_footer": "",
        }
    return {
        "smtp_host": cfg.smtp_host or "",
        "smtp_port": cfg.smtp_port or 587,
        "smtp_user": cfg.smtp_user or "",
        "smtp_pass": "",  # never expose password
        "smtp_from": cfg.smtp_from or "noreply@itsm.local",
        "reply_to": cfg.reply_to or "",
        "slack_webhook_url": cfg.slack_webhook_url or "",
        "teams_webhook_url": cfg.teams_webhook_url or "",
        "email_signature": cfg.email_signature or "",
        "email_footer": cfg.email_footer or "",
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
    cfg.reply_to  = data.get("reply_to", "")
    cfg.slack_webhook_url = data.get("slack_webhook_url", "")
    cfg.teams_webhook_url = data.get("teams_webhook_url", "")
    cfg.email_signature = data.get("email_signature", "")
    cfg.email_footer = data.get("email_footer", "")
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
def admin_list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=1000),
    search: str = Query("", alias="search"),
    role: str = Query("", alias="role"),
    tenant_id: int | None = Query(None, alias="tenant_id"),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    if admin.role == UserRole.SUPER_ADMIN:
        query = db.query(User)
    else:
        query = db.query(User).filter(User.tenant_id == admin.tenant_id)

    # Filter by tenant (super admin only)
    if tenant_id and admin.role == UserRole.SUPER_ADMIN:
        query = query.filter(User.tenant_id == tenant_id)

    # Filter by role
    if role:
        try:
            query = query.filter(User.role == UserRole(role))
        except ValueError:
            pass

    # Live search — ID, name, email, employee_id
    if search:
        from sqlalchemy import or_
        import re as _re
        s = f"%{search}%"
        id_match = _re.search(r'\d+', search)
        conditions = [
            User.full_name.ilike(s),
            User.email.ilike(s),
            User.employee_id.ilike(s),
            User.department.ilike(s),
            User.job_title.ilike(s),
        ]
        if id_match:
            conditions.append(User.id == int(id_match.group()))
        query = query.filter(or_(*conditions))

    total = query.count()
    users = query.order_by(User.tenant_id, User.id).offset(skip).limit(limit).all()
    # Pre-load tenants
    tenant_ids = {u.tenant_id for u in users}
    tenant_map = {t.id: t.name for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()}
    result = []
    for u in users:
        result.append({
            "id": u.id, "email": u.email, "full_name": u.full_name,
            "role": u.role, "is_active": u.is_active,
            "job_title": u.job_title, "department": u.department,
            "employee_id": getattr(u, 'employee_id', None),
            "tenant_id": u.tenant_id,
            "tenant_name": tenant_map.get(u.tenant_id, "—"),
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
        employee_id=getattr(user_data, 'employee_id', None),
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
            employee_id=(row.get("employee_id") or "").strip() or None,
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

# =============================================================================
# AUTOMATION RULES
# =============================================================================

@app.get("/admin/automation-rules")
def list_automation_rules(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rules = db.query(AutomationRule).filter(AutomationRule.tenant_id == admin.tenant_id).order_by(AutomationRule.created_at.desc()).all()
    return [{"id": r.id, "name": r.name, "description": r.description, "is_active": r.is_active,
             "trigger": r.trigger, "conditions": json.loads(r.conditions) if r.conditions else [],
             "actions": json.loads(r.actions) if r.actions else [],
             "run_count": r.run_count or 0, "last_run_at": r.last_run_at, "created_at": r.created_at} for r in rules]

@app.post("/admin/automation-rules")
def create_automation_rule(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
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

@app.patch("/admin/automation-rules/{rule_id}")
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

@app.delete("/admin/automation-rules/{rule_id}")
def delete_automation_rule(rule_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id, AutomationRule.tenant_id == admin.tenant_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}

@app.post("/admin/automation-rules/{rule_id}/test")
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

# =============================================================================
# AGENT GROUPS
# =============================================================================

@app.get("/groups/")
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

@app.post("/groups/")
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

@app.patch("/groups/{group_id}")
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

@app.delete("/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    group = db.query(Group).filter(Group.id == group_id, Group.tenant_id == admin.tenant_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    # Unassign tickets from this group
    db.query(Ticket).filter(Ticket.group_id == group_id).update({"group_id": None})
    db.delete(group)
    db.commit()
    return {"ok": True}

# =============================================================================
# CUSTOM TICKET FIELDS
# =============================================================================

@app.get("/admin/custom-fields")
def list_custom_fields(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fields = db.query(CustomField).filter(CustomField.tenant_id == current_user.tenant_id).order_by(CustomField.sort_order).all()
    return [{"id": f.id, "name": f.name, "field_key": f.field_key, "field_type": f.field_type,
             "options": json.loads(f.options) if f.options else [],
             "is_required": f.is_required, "applies_to": f.applies_to, "sort_order": f.sort_order} for f in fields]

@app.post("/admin/custom-fields")
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

@app.put("/admin/custom-fields/{field_id}")
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

@app.delete("/admin/custom-fields/{field_id}")
def delete_custom_field(field_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    field = db.query(CustomField).filter(CustomField.id == field_id, CustomField.tenant_id == admin.tenant_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(field)
    db.commit()
    return {"ok": True}

# =============================================================================
# MACROS
# =============================================================================

@app.get("/macros/")
def list_macros(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Macro).filter(Macro.tenant_id == current_user.tenant_id)
    query = query.filter((Macro.is_shared == True) | (Macro.created_by_id == current_user.id))
    macros = query.order_by(Macro.name).all()
    return [{"id": m.id, "name": m.name, "description": m.description,
             "actions": json.loads(m.actions) if m.actions else [],
             "is_shared": m.is_shared, "run_count": m.run_count or 0,
             "created_by": m.created_by.full_name if m.created_by else "Unknown"} for m in macros]

@app.post("/macros/")
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

@app.put("/macros/{macro_id}")
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

@app.delete("/macros/{macro_id}")
def delete_macro(macro_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    macro = db.query(Macro).filter(Macro.id == macro_id, Macro.tenant_id == current_user.tenant_id).first()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro not found")
    db.delete(macro)
    db.commit()
    return {"ok": True}

@app.post("/macros/{macro_id}/apply/{ticket_id}")
def apply_macro(macro_id: int, ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Apply a macro to a ticket — executes all actions in sequence."""
    macro = db.query(Macro).filter(Macro.id == macro_id, Macro.tenant_id == current_user.tenant_id).first()
    if not macro:
        raise HTTPException(status_code=404, detail="Macro not found")
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    actions = json.loads(macro.actions) if macro.actions else []
    applied = []
    for action in actions:
        act_type = action.get("type")
        val = action.get("value")
        try:
            if act_type == "set_status" and val:
                ticket.status = TicketStatus(val)
                applied.append(f"Status → {val}")
            elif act_type == "set_priority" and val:
                ticket.priority = TicketPriority(val)
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

# =============================================================================
# SAVED TICKET VIEWS
# =============================================================================

@app.get("/ticket-views/")
def list_ticket_views(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    views = db.query(TicketView).filter(
        TicketView.tenant_id == current_user.tenant_id,
        (TicketView.is_shared == True) | (TicketView.created_by_id == current_user.id)
    ).order_by(TicketView.sort_order, TicketView.name).all()
    return [{"id": v.id, "name": v.name, "filters": json.loads(v.filters) if v.filters else {},
             "is_shared": v.is_shared, "is_mine": v.created_by_id == current_user.id,
             "created_by": v.created_by.full_name if v.created_by else ""} for v in views]

@app.post("/ticket-views/")
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

@app.put("/ticket-views/{view_id}")
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

@app.delete("/ticket-views/{view_id}")
def delete_ticket_view(view_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    view = db.query(TicketView).filter(TicketView.id == view_id, TicketView.tenant_id == current_user.tenant_id,
                                       TicketView.created_by_id == current_user.id).first()
    if not view:
        raise HTTPException(status_code=404, detail="View not found or not yours")
    db.delete(view)
    db.commit()
    return {"ok": True}

# =============================================================================
# TICKET TASKS
# =============================================================================

@app.get("/tickets/{ticket_id}/tasks")
def list_ticket_tasks(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    tasks = db.query(TicketTask).filter(TicketTask.ticket_id == ticket_id).order_by(TicketTask.created_at).all()
    return [{"id": t.id, "title": t.title, "is_done": t.is_done,
             "assigned_to_id": t.assigned_to_id,
             "assigned_to_name": t.assigned_to.full_name if t.assigned_to else None,
             "due_date": t.due_date, "created_at": t.created_at} for t in tasks]

@app.post("/tickets/{ticket_id}/tasks")
def create_ticket_task(ticket_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
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

@app.patch("/tickets/{ticket_id}/tasks/{task_id}")
def update_ticket_task(ticket_id: int, task_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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

@app.delete("/tickets/{ticket_id}/tasks/{task_id}")
def delete_ticket_task(ticket_id: int, task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(TicketTask).filter(TicketTask.id == task_id, TicketTask.ticket_id == ticket_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}

# =============================================================================
# TICKET TEMPLATES
# =============================================================================

@app.get("/ticket-templates/")
def list_ticket_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    templates = db.query(TicketTemplate).filter(TicketTemplate.tenant_id == current_user.tenant_id).order_by(TicketTemplate.name).all()
    return [{"id": t.id, "name": t.name, "ticket_type": t.ticket_type, "title": t.title,
             "description": t.description, "category": t.category, "priority": t.priority,
             "tags": json.loads(t.tags) if t.tags else []} for t in templates]

@app.post("/ticket-templates/")
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

@app.put("/ticket-templates/{tmpl_id}")
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

@app.delete("/ticket-templates/{tmpl_id}")
def delete_ticket_template(tmpl_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tmpl = db.query(TicketTemplate).filter(TicketTemplate.id == tmpl_id, TicketTemplate.tenant_id == admin.tenant_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tmpl)
    db.commit()
    return {"ok": True}

# =============================================================================
# PROBLEM MANAGEMENT
# =============================================================================

@app.get("/tickets/{ticket_id}/problem-links")
def get_problem_links(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # This ticket as problem — show linked incidents
    as_problem = db.query(ProblemLink).filter(ProblemLink.problem_ticket_id == ticket_id).all()
    # This ticket as incident — show its problem
    as_incident = db.query(ProblemLink).filter(ProblemLink.incident_ticket_id == ticket_id).all()
    def fmt(t_id):
        t = db.query(Ticket).filter(Ticket.id == t_id).first()
        return {"id": t.id, "title": t.title, "status": t.status.value if t else "", "ticket_type": t.ticket_type.value if t else ""} if t else None
    return {
        "linked_incidents": [fmt(l.incident_ticket_id) for l in as_problem if fmt(l.incident_ticket_id)],
        "linked_problem": fmt(as_incident[0].problem_ticket_id) if as_incident else None
    }

@app.post("/tickets/{ticket_id}/problem-links")
def link_problem(ticket_id: int, data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Link ticket_id (incident) to a problem ticket."""
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

@app.delete("/tickets/{ticket_id}/problem-links")
def unlink_problem(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    link = db.query(ProblemLink).filter(ProblemLink.incident_ticket_id == ticket_id).first()
    if link:
        db.delete(link)
        db.commit()
    return {"ok": True}

# =============================================================================
# @MENTION NOTIFICATIONS — triggered from comment creation
# =============================================================================

def process_mentions(body: str, ticket_id: int, tenant_id: int, actor: User, db: Session):
    """Parse @Name mentions in comment body and create notifications."""
    mentions = re.findall(r'@([A-Za-z][A-Za-z0-9 ]{1,30}?)(?=\s|$|[,.])', body)
    for mention in mentions:
        mention = mention.strip()
        # Find user by first name or full name match
        users = db.query(User).filter(
            User.tenant_id == tenant_id,
            User.full_name.ilike(f"%{mention}%")
        ).all()
        for u in users:
            if u.id != actor.id:
                create_notification(
                    user_id=u.id, tenant_id=tenant_id,
                    type="mention",
                    title=f"You were mentioned in ticket #{ticket_id}",
                    body=f"{actor.full_name} mentioned you: {body[:100]}",
                    link=f"/tickets/{ticket_id}",
                    db=db
                )

# =============================================================================
# CANNED RESPONSES
# =============================================================================

def _cr_to_out(r, db):
    author = db.query(User).filter(User.id == r.author_id).first()
    return {
        "id": r.id, "title": r.title, "content": r.content,
        "category": r.category, "author_id": r.author_id,
        "author_name": author.full_name if author else "Unknown",
        "visibility": r.visibility or "all",
        "group_id": r.group_id,
        "use_count": r.use_count or 0,
        "sort_order": r.sort_order or 0,
        "created_at": r.created_at, "updated_at": r.updated_at,
    }

@app.get("/canned-responses/")
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
            CannedResponse.title.ilike(f"%{search}%") |
            CannedResponse.content.ilike(f"%{search}%")
        )
    total = query.count()
    responses = query.order_by(CannedResponse.sort_order, CannedResponse.title).offset(skip).limit(limit).all()
    return {"items": [_cr_to_out(r, db) for r in responses], "total": total}

@app.get("/canned-responses/categories")
def list_canned_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return all distinct categories (folders) used in canned responses."""
    rows = db.query(CannedResponse.category).filter(
        CannedResponse.tenant_id == current_user.tenant_id,
        CannedResponse.category != None,
        CannedResponse.category != ""
    ).distinct().all()
    return sorted([r[0] for r in rows if r[0]])

@app.post("/canned-responses/", response_model=CannedResponseOut)
def create_canned_response(
    response: CannedResponseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not has_permission(current_user, Permission.MANAGE_CANNED):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    db_response = CannedResponse(
        tenant_id=current_user.tenant_id,
        title=response.title,
        content=response.content,
        category=response.category,
        author_id=current_user.id,
        visibility=getattr(response, "visibility", "all") or "all",
        group_id=getattr(response, "group_id", None),
    )
    db.add(db_response)
    db.commit()
    db.refresh(db_response)
    return _cr_to_out(db_response, db)

@app.put("/canned-responses/{response_id}", response_model=CannedResponseOut)
def update_canned_response(
    response_id: int,
    response_update: CannedResponseUpdate,
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
    update_data = response_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_response, key, value)
    db.commit()
    db.refresh(db_response)
    return _cr_to_out(db_response, db)

@app.post("/canned-responses/{response_id}/use")
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

@app.delete("/canned-responses/{response_id}")
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
        "phone": current_user.phone,
        "timezone": current_user.timezone or "UTC",
        "availability": current_user.availability or "online",
        "notification_prefs": json.loads(current_user.notification_prefs) if current_user.notification_prefs else {},
        "created_at": current_user.created_at,
    }

@app.patch("/users/me/availability")
def update_availability(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update agent availability status — online | busy | away | offline."""
    status = data.get("availability", "online")
    if status not in ["online", "busy", "away", "offline"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    current_user.availability = status
    db.commit()
    return {"ok": True, "availability": status}

@app.get("/users/availability")
def list_team_availability(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lightweight endpoint — returns availability status for all active agents/admins in the tenant.
    Used for the team availability panel and refreshed periodically."""
    if current_user.role not in [UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    users = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.is_active == True,
        User.role.in_([UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN])
    ).all()
    order = {"online": 0, "busy": 1, "away": 2, "offline": 3}
    items = sorted(
        [{"id": u.id, "full_name": u.full_name, "profile_photo": u.profile_photo,
          "availability": u.availability or "online"} for u in users],
        key=lambda u: order.get(u["availability"], 4)
    )
    return items

@app.get("/users/me/notification-prefs")
def get_notification_prefs(current_user: User = Depends(get_current_user)):
    default_prefs = {
        "ticket_assigned": True,
        "ticket_commented": True,
        "ticket_status_changed": True,
        "ticket_sla_breach": True,
        "ticket_mentioned": True,
        "change_approved": True,
        "change_rejected": True,
        "email_ticket_assigned": True,
        "email_ticket_commented": True,
        "email_sla_breach": True,
    }
    if current_user.notification_prefs:
        try:
            stored = json.loads(current_user.notification_prefs)
            return {**default_prefs, **stored}
        except Exception:
            pass
    return default_prefs

@app.put("/users/me/notification-prefs")
def update_notification_prefs(data: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.notification_prefs = json.dumps(data)
    db.commit()
    return {"ok": True}

@app.post("/admin/email-config/test")
def test_email_config(data: dict, admin: User = Depends(get_current_admin_user), db: Session = Depends(get_db)):
    """Send a test email using the current SMTP configuration."""
    to_email = data.get("to_email", admin.email)
    cfg = get_email_config(db, admin.tenant_id)
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText("<p>This is a test email from DodoDesk. Your email configuration is working correctly.</p>", "html")
        msg["Subject"] = "DodoDesk — Test Email"
        msg["From"] = cfg.get("smtp_from") or cfg.get("smtp_user") or "noreply@dodoDesk.com"
        msg["To"] = to_email
        host = cfg.get("smtp_host", "")
        port = int(cfg.get("smtp_port", 587))
        user = cfg.get("smtp_user", "")
        password = cfg.get("smtp_pass", "")
        if not host:
            raise ValueError("SMTP host not configured")
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return {"ok": True, "message": f"Test email sent to {to_email}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}

@app.get("/admin/integrations-status")
def get_integrations_status(admin: User = Depends(get_current_admin_user), db: Session = Depends(get_db)):
    """Return status of all configured integrations for this tenant."""
    cfg = db.query(EmailConfig).filter(EmailConfig.tenant_id == admin.tenant_id).first()
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    return {
        "slack": {"configured": bool(cfg and cfg.slack_webhook_url), "url": cfg.slack_webhook_url if cfg else ""},
        "teams": {"configured": bool(cfg and cfg.teams_webhook_url), "url": cfg.teams_webhook_url if cfg else ""},
        "smtp": {"configured": bool(cfg and cfg.smtp_host), "host": cfg.smtp_host if cfg else ""},
        "sso": {"configured": bool(tenant and tenant.sso_enabled), "provider": tenant.sso_provider if tenant else ""},
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
    if current_user.role == UserRole.EMPLOYEE:
        query = query.filter(ServiceCatalogItem.visibility.in_(["all", "employees_only"]))
    elif current_user.role in [UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN]:
        query = query.filter(ServiceCatalogItem.visibility.in_(["all", "agents_only"]))
    if search:
        query = query.filter(
            ServiceCatalogItem.name.ilike(f"%{search}%") |
            ServiceCatalogItem.description.ilike(f"%{search}%")
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

@app.get("/catalog/categories")
def get_catalog_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all distinct categories used in the catalog."""
    items = db.query(ServiceCatalogItem.category).filter(
        ServiceCatalogItem.tenant_id == current_user.tenant_id,
        ServiceCatalogItem.is_active == True,
        ServiceCatalogItem.category != None,
        ServiceCatalogItem.category != ""
    ).distinct().all()
    return sorted([i[0] for i in items if i[0]])

@app.patch("/catalog/{item_id}/sort")
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
def get_system_audit_log(
    limit: int = 50,
    offset: int = 0,
    action: str = None,
    actor_id: int = None,
    search: str = None,
    target_type: str = None,
    start_date: date = None,
    end_date: date = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """Returns system audit log with full filtering support."""
    query = db.query(SystemAuditLog)
    if admin.role != UserRole.SUPER_ADMIN:
        query = query.filter(SystemAuditLog.tenant_id == admin.tenant_id)
    if action:
        query = query.filter(SystemAuditLog.action.ilike(f"%{action}%"))
    if actor_id:
        query = query.filter(SystemAuditLog.actor_id == actor_id)
    if target_type:
        query = query.filter(SystemAuditLog.target_type == target_type)
    if search:
        term = f"%{search}%"
        query = query.filter(
            SystemAuditLog.actor_email.ilike(term) |
            SystemAuditLog.action.ilike(term) |
            SystemAuditLog.target_label.ilike(term) |
            SystemAuditLog.new_value.ilike(term)
        )
    if start_date:
        query = query.filter(SystemAuditLog.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.filter(SystemAuditLog.created_at <= datetime.combine(end_date, datetime.max.time()))
    total = query.count()
    logs = query.order_by(SystemAuditLog.created_at.desc()).offset(offset).limit(limit).all()
    actor_ids = {log.actor_id for log in logs if log.actor_id}
    actor_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    # Category counts
    by_category = {}
    base = db.query(SystemAuditLog.action, sa_func.count())
    if admin.role != UserRole.SUPER_ADMIN:
        base = base.filter(SystemAuditLog.tenant_id == admin.tenant_id)
    for action_name, count in base.group_by(SystemAuditLog.action).all():
        cat = action_name.split(".")[0] if action_name and "." in action_name else "other"
        by_category[cat] = by_category.get(cat, 0) + count
    return {
        "total": total,
        "by_category": by_category,
        "items": [{
            "id": log.id,
            "actor_id": log.actor_id,
            "actor_email": log.actor_email,
            "actor_name": actor_map.get(log.actor_id, log.actor_email or "System"),
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "target_label": log.target_label,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "ip_address": log.ip_address,
            "created_at": log.created_at,
            "tenant_id": log.tenant_id,
        } for log in logs]
    }

@app.get("/admin/audit-log/export/csv")
def export_audit_log_csv(
    action: str = None,
    search: str = None,
    start_date: date = None,
    end_date: date = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    query = db.query(SystemAuditLog)
    if admin.role != UserRole.SUPER_ADMIN:
        query = query.filter(SystemAuditLog.tenant_id == admin.tenant_id)
    if action:
        query = query.filter(SystemAuditLog.action.ilike(f"%{action}%"))
    if search:
        term = f"%{search}%"
        query = query.filter(SystemAuditLog.actor_email.ilike(term) | SystemAuditLog.action.ilike(term) | SystemAuditLog.target_label.ilike(term))
    if start_date:
        query = query.filter(SystemAuditLog.created_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        query = query.filter(SystemAuditLog.created_at <= datetime.combine(end_date, datetime.max.time()))
    logs = query.order_by(SystemAuditLog.created_at.desc()).limit(5000).all()
    actor_ids = {log.actor_id for log in logs if log.actor_id}
    actor_map = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp","Action","Actor Name","Actor Email","Target Type","Target","Old Value","New Value","IP Address"])
    for log in logs:
        writer.writerow([
            log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
            log.action or "",
            actor_map.get(log.actor_id, ""),
            log.actor_email or "",
            log.target_type or "",
            log.target_label or log.target_id or "",
            log.old_value or "",
            log.new_value or "",
            log.ip_address or "",
        ])
    return Response(content=output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=audit_log.csv"})

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

@app.delete("/superadmin/tenants/{tenant_id}")
def delete_tenant(tenant_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Permanently delete a tenant and all its data. Super admin only."""
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only super admin can delete tenants")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if admin.tenant_id == tenant_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own tenant.")
    try:
        from sqlalchemy import text as _text
        # Use raw SQL DELETE in dependency order to avoid FK violations
        with db.bind.connect() as conn:
            tid = tenant_id

            # ── Level 1: deepest children first ──────────────────────────
            # chat_messages → chat_sessions (no tenant_id)
            conn.execute(_text("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE tenant_id = :t)"), {"t": tid})

            # comments → tickets (no tenant_id)
            conn.execute(_text("DELETE FROM comments WHERE ticket_id IN (SELECT id FROM tickets WHERE tenant_id = :t)"), {"t": tid})

            # attachments → tickets (no tenant_id)
            conn.execute(_text("DELETE FROM attachments WHERE ticket_id IN (SELECT id FROM tickets WHERE tenant_id = :t)"), {"t": tid})

            # ticket_approvals → tickets (no tenant_id)
            conn.execute(_text("DELETE FROM ticket_approvals WHERE ticket_id IN (SELECT id FROM tickets WHERE tenant_id = :t)"), {"t": tid})

            # approval_steps → approval_workflows (no tenant_id)
            conn.execute(_text("DELETE FROM approval_steps WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE tenant_id = :t)"), {"t": tid})

            # canned_responses → users (no tenant_id)
            conn.execute(_text("DELETE FROM canned_responses WHERE author_id IN (SELECT id FROM users WHERE tenant_id = :t)"), {"t": tid})

            # ── Level 2: tables with direct tenant_id ────────────────────
            conn.execute(_text("DELETE FROM chat_sessions WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM ticket_watchers WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM ticket_audit_logs WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM tickets WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM change_requests WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM system_audit_logs WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM signup_verifications WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM notifications WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM kb_articles WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM assets WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM service_catalog_items WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM email_configs WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM approval_workflows WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM sla_configs WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM escalation_rules WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM business_hours_configs WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM custom_roles WHERE tenant_id = :t"), {"t": tid})

            # ── Level 3: users then tenant ────────────────────────────────
            conn.execute(_text("DELETE FROM users WHERE tenant_id = :t"), {"t": tid})
            conn.execute(_text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
            conn.commit()
        return {"ok": True, "message": f"Tenant '{tenant.name}' and all its data have been deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete tenant: {str(e)}")

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
# TENANT DATA EXPORT — Super admin can export all data for any tenant
# =============================================================================

@app.get("/superadmin/admin-access")
def list_admin_access(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """List all admin-to-tenant access grants. Super admin only."""
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin only")
    records = db.query(AdminTenantAccess).all()
    return [{
        "id": r.id,
        "admin_user_id": r.admin_user_id,
        "admin_name": r.admin_user.full_name if r.admin_user else "",
        "admin_email": r.admin_user.email if r.admin_user else "",
        "tenant_id": r.tenant_id,
        "tenant_name": r.tenant.name if r.tenant else "",
        "granted_at": r.granted_at,
    } for r in records]

@app.post("/superadmin/admin-access")
def grant_admin_access(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Grant an admin access to an additional tenant. Super admin only."""
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin only")
    admin_user_id = data.get("admin_user_id")
    tenant_id = data.get("tenant_id")
    if not admin_user_id or not tenant_id:
        raise HTTPException(status_code=400, detail="admin_user_id and tenant_id are required")
    # Verify target user is an admin
    target = db.query(User).filter(User.id == admin_user_id).first()
    if not target or target.role not in [UserRole.ADMIN]:
        raise HTTPException(status_code=400, detail="Target user must be an Admin role")
    # Check tenant exists
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    # Check not already granted
    existing = db.query(AdminTenantAccess).filter(
        AdminTenantAccess.admin_user_id == admin_user_id,
        AdminTenantAccess.tenant_id == tenant_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Access already granted")
    access = AdminTenantAccess(admin_user_id=admin_user_id, tenant_id=tenant_id, granted_by_id=admin.id)
    db.add(access)
    db.commit()
    return {"ok": True, "admin_user_id": admin_user_id, "tenant_id": tenant_id}

@app.delete("/superadmin/admin-access/{access_id}")
def revoke_admin_access(access_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Revoke an admin's access to a tenant. Super admin only."""
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin only")
    record = db.query(AdminTenantAccess).filter(AdminTenantAccess.id == access_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Access record not found")
    db.delete(record)
    db.commit()
    return {"ok": True}

@app.get("/superadmin/tenants/{tenant_id}/export")
def export_tenant_data(tenant_id: int, db: Session = Depends(get_db),
                       admin: User = Depends(get_current_admin_user)):
    """Export all data for a tenant as a multi-sheet Excel file."""
    if admin.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin only")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    import io as _io

    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove default sheet

    HEADER_FILL  = PatternFill("solid", fgColor="4F46E5")
    HEADER_FONT  = Font(bold=True, color="FFFFFF", size=11)
    HEADER_ALIGN = Alignment(horizontal="center", vertical="center")

    def make_sheet(title, headers, rows):
        ws = wb.create_sheet(title=title[:31])  # Excel sheet name max 31 chars
        ws.append(headers)
        # Style header row
        for col, _ in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = HEADER_ALIGN
        for row in rows:
            ws.append([str(v) if v is not None else "" for v in row])
        # Auto-width columns
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=8)
            ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 4, 60)
        ws.freeze_panes = "A2"
        return ws

    # ── Sheet 1: Tenant Info ────────────────────────────────────────────────
    make_sheet("Tenant Info",
        ["Field", "Value"],
        [
            ["ID", tenant.id],
            ["Name", tenant.name],
            ["Slug", tenant.slug],
            ["Plan", tenant.plan],
            ["Active", tenant.is_active],
            ["Primary Color", tenant.primary_color],
            ["Support Email", tenant.support_email],
            ["Company Tagline", tenant.company_tagline],
        ]
    )

    # ── Sheet 2: Users ──────────────────────────────────────────────────────
    users = db.query(User).filter(User.tenant_id == tenant_id).all()
    make_sheet("Users",
        ["ID", "Full Name", "Email", "Role", "Job Title", "Department", "Active", "MFA Enabled", "Created At"],
        [(u.id, u.full_name, u.email, u.role.value if u.role else "",
          getattr(u, 'job_title', ''), getattr(u, 'department', ''),
          u.is_active, getattr(u, 'mfa_enabled', False),
          str(u.created_at)[:19] if u.created_at else "") for u in users]
    )

    # ── Sheet 3: Tickets ────────────────────────────────────────────────────
    tickets = db.query(Ticket).filter(Ticket.tenant_id == tenant_id).all()
    user_map = {u.id: u.full_name for u in users}
    make_sheet("Tickets",
        ["ID", "Ref", "Type", "Title", "Status", "Priority", "Category",
         "Requester", "Assigned To", "Created At", "Resolved At"],
        [(t.id,
          f"{'INC' if t.ticket_type and 'incident' in str(t.ticket_type).lower() else 'REQ'}-{t.id:04d}",
          str(t.ticket_type.value) if t.ticket_type else "",
          t.title, str(t.status.value) if t.status else "",
          str(t.priority.value) if t.priority else "",
          t.category or "",
          user_map.get(t.requester_id, str(t.requester_id)),
          user_map.get(t.assigned_to_id, "") if t.assigned_to_id else "Unassigned",
          str(t.created_at)[:19] if t.created_at else "",
          str(t.resolved_at)[:19] if getattr(t, 'resolved_at', None) else ""
         ) for t in tickets]
    )

    # ── Sheet 4: Assets ─────────────────────────────────────────────────────
    assets = db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    make_sheet("Assets",
        ["ID", "Name", "Type", "Serial Number", "Status", "Assigned To", "Vendor", "Expiry Date"],
        [(a.id, a.name, str(a.asset_type.value) if getattr(a, 'asset_type', None) else "",
          getattr(a, 'serial_number', '') or "",
          str(a.status.value) if getattr(a, 'status', None) else "",
          user_map.get(a.assigned_to_id, "") if getattr(a, 'assigned_to_id', None) else "",
          getattr(a, 'vendor', '') or "",
          str(getattr(a, 'expiry_date', '') or "")) for a in assets]
    )

    # ── Sheet 5: Knowledge Base ─────────────────────────────────────────────
    articles = db.query(KBArticle).filter(KBArticle.tenant_id == tenant_id).all()
    make_sheet("Knowledge Base",
        ["ID", "Title", "Category", "Author", "Created At"],
        [(a.id, a.title, getattr(a, 'category', '') or "",
          user_map.get(getattr(a, 'author_id', None), ""),
          str(a.created_at)[:19] if getattr(a, 'created_at', None) else "") for a in articles]
    )

    # ── Sheet 6: Service Catalog ────────────────────────────────────────────
    catalog = db.query(ServiceCatalogItem).filter(ServiceCatalogItem.tenant_id == tenant_id).all()
    make_sheet("Service Catalog",
        ["ID", "Name", "Category", "Priority", "Estimated Cost", "Delivery Days", "Requires Approval"],
        [(c.id, c.name, c.category or "",
          str(c.priority.value) if getattr(c, 'priority', None) else "",
          getattr(c, 'estimated_cost', '') or "",
          getattr(c, 'delivery_time_days', '') or "",
          getattr(c, 'approval_required', False)) for c in catalog]
    )

    # ── Sheet 7: Audit Log ──────────────────────────────────────────────────
    logs = db.query(SystemAuditLog).filter(SystemAuditLog.tenant_id == tenant_id)\
              .order_by(SystemAuditLog.id.desc()).limit(5000).all()
    make_sheet("Audit Log",
        ["ID", "Timestamp", "Action", "Actor", "Target", "Changes"],
        [(l.id,
          str(l.created_at)[:19] if getattr(l, 'created_at', None) else "",
          getattr(l, 'action', '') or "",
          user_map.get(getattr(l, 'actor_id', None), str(getattr(l, 'actor_id', ''))),
          getattr(l, 'target_type', '') or "",
          str(getattr(l, 'changes', '') or "")[:200]) for l in logs]
    )

    # ── Stream Excel file ───────────────────────────────────────────────────
    output = _io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"dodesk_export_{tenant.slug}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    print(f"✅ Tenant data export: {tenant.name} ({len(tickets)} tickets, {len(users)} users)")

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


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
- When user asks to "see", "track", "show", or "list" their tickets — use list_my_tickets, not search_tickets
- Use search_tickets only when the user provides a specific keyword to search for
- Always confirm ticket details before creating one
- Cite KB article titles when referencing knowledge base content
- Never fabricate ticket IDs or asset data — use tools only
- Format ticket IDs as INC-XXXX or REQ-XXXX
- If you cannot help, suggest the user raise a ticket
"""

CHAT_TOOLS = [
    {
        "name": "list_my_tickets",
        "description": "List the current user's tickets, optionally filtered by status. Use when the user asks to see, track, or check their tickets.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["open", "in_progress", "resolved", "closed", "all"]},
                "limit":  {"type": "integer", "description": "Max tickets to return (default 10)"}
            }
        }
    },
    {
        "name": "search_tickets",
        "description": "Search the user's tickets by keyword. Returns up to 5 matching tickets.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    },
    {
        "name": "get_ticket",
        "description": "Get full details of a specific ticket by its numeric ID.",
        "input_schema": {
            "type": "object",
            "properties": {"ticket_id": {"type": "integer"}},
            "required": ["ticket_id"]
        }
    },
    {
        "name": "create_ticket",
        "description": "Create a new support ticket on behalf of the user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title":       {"type": "string"},
                "description": {"type": "string"},
                "priority":    {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                "ticket_type": {"type": "string", "enum": ["incident", "service_request"]},
                "category":    {"type": "string"}
            },
            "required": ["title", "description"]
        }
    },
    {
        "name": "update_ticket",
        "description": "Update a ticket's status, priority, or add a comment. Use when the user asks to close, resolve, reopen, or update a ticket.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticket_id": {"type": "integer"},
                "status":    {"type": "string", "enum": ["open", "in_progress", "resolved", "closed"], "description": "New status (optional)"},
                "priority":  {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "New priority (optional)"},
                "comment":   {"type": "string", "description": "Comment to add to the ticket (optional)"}
            },
            "required": ["ticket_id"]
        }
    },
    {
        "name": "search_kb",
        "description": "Search the knowledge base for articles matching a query. Always search KB before suggesting the user raise a ticket.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    },
    {
        "name": "list_kb_articles",
        "description": "List published KB articles, optionally filtered by category.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Filter by category (optional)"},
                "limit":    {"type": "integer", "description": "Max articles to return (default 8)"}
            }
        }
    },
    {
        "name": "get_asset",
        "description": "Look up details of an IT asset by its numeric ID.",
        "input_schema": {
            "type": "object",
            "properties": {"asset_id": {"type": "integer"}},
            "required": ["asset_id"]
        }
    },
    {
        "name": "list_my_assets",
        "description": "List assets assigned to the current user.",
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "Max assets to return (default 10)"}},
        }
    },
    {
        "name": "check_sla",
        "description": "Check SLA status for the current user's open tickets — which are overdue, near breach, or on track.",
        "input_schema": {"type": "object", "properties": {}}
    },
]

def _execute_tool(tool_name: str, tool_input: dict, current_user: User, db: Session) -> str:
    import json as _json

    def _ticket_prefix(t):
        return "INC" if t.ticket_type and "incident" in str(t.ticket_type) else "REQ"

    if tool_name == "list_my_tickets":
        status_filter = tool_input.get("status", "all")
        limit = min(int(tool_input.get("limit", 10)), 20)
        query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
        if current_user.role == UserRole.EMPLOYEE:
            query = query.filter(Ticket.requester_id == current_user.id)
        if status_filter and status_filter != "all":
            try: query = query.filter(Ticket.status == TicketStatus(status_filter))
            except ValueError: pass
        tickets = query.order_by(Ticket.created_at.desc()).limit(limit).all()
        if not tickets:
            return f"No tickets found{' with status ' + status_filter if status_filter != 'all' else ''}."
        return "\n".join(f"{_ticket_prefix(t)}-{t.id:04d}: {t.title} [{t.status.value}] [{t.priority.value}]" for t in tickets)

    elif tool_name == "search_tickets":
        q = f"%{tool_input.get('query', '')}%"
        tickets = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            (Ticket.title.ilike(q)) | (Ticket.description.ilike(q))
        ).order_by(Ticket.created_at.desc()).limit(5).all()
        if not tickets:
            return f"No tickets found matching '{tool_input.get('query')}'."
        return "\n".join(f"{_ticket_prefix(t)}-{t.id:04d}: {t.title} [{t.status.value}] [{t.priority.value}]" for t in tickets)

    elif tool_name == "get_ticket":
        tid = tool_input.get("ticket_id")
        t = db.query(Ticket).filter(Ticket.id == tid, Ticket.tenant_id == current_user.tenant_id).first()
        if not t: return f"Ticket #{tid} not found."
        assignee = db.query(User).filter(User.id == t.assigned_to_id).first() if t.assigned_to_id else None
        sla_info = ""
        if t.sla_resolution_deadline:
            diff = (t.sla_resolution_deadline - datetime.utcnow()).total_seconds()
            if diff < 0: sla_info = f"\nSLA: ⚠️ OVERDUE by {abs(int(diff//3600))}h"
            elif diff < 3600: sla_info = f"\nSLA: ⏰ {int(diff//60)}m remaining"
            else: sla_info = f"\nSLA: ✅ {int(diff//3600)}h remaining"
        return (f"Ticket {_ticket_prefix(t)}-{t.id:04d}\n"
                f"Title: {t.title}\nStatus: {t.status.value}\nPriority: {t.priority.value}\n"
                f"Category: {t.category or 'Uncategorised'}\n"
                f"Assigned to: {assignee.full_name if assignee else 'Unassigned'}{sla_info}\n"
                f"Description: {t.description[:300]}")

    elif tool_name == "create_ticket":
        new_t = Ticket(
            tenant_id=current_user.tenant_id, requester_id=current_user.id,
            title=tool_input.get("title", ""), description=tool_input.get("description", ""),
            priority=TicketPriority(tool_input.get("priority", "medium")),
            ticket_type=TicketType(tool_input.get("ticket_type", "service_request")),
            category=tool_input.get("category", "Other"), status=TicketStatus.OPEN,
        )
        db.add(new_t); db.commit(); db.refresh(new_t)
        prefix = "INC" if new_t.ticket_type == TicketType.INCIDENT else "REQ"
        return f"✅ Ticket created: {prefix}-{new_t.id:04d} — \"{new_t.title}\"\nYou can track it on your dashboard."

    elif tool_name == "update_ticket":
        tid = tool_input.get("ticket_id")
        t = db.query(Ticket).filter(Ticket.id == tid, Ticket.tenant_id == current_user.tenant_id).first()
        if not t: return f"Ticket #{tid} not found."
        changes = []
        if "status" in tool_input and tool_input["status"]:
            try:
                t.status = TicketStatus(tool_input["status"])
                changes.append(f"status → {tool_input['status']}")
            except ValueError: pass
        if "priority" in tool_input and tool_input["priority"]:
            try:
                t.priority = TicketPriority(tool_input["priority"])
                changes.append(f"priority → {tool_input['priority']}")
            except ValueError: pass
        if "comment" in tool_input and tool_input["comment"]:
            comment = Comment(ticket_id=t.id, author_id=current_user.id,
                              body=tool_input["comment"], is_internal=False)
            db.add(comment)
            changes.append("comment added")
        db.commit()
        if not changes: return f"No changes made to ticket #{tid}."
        return f"✅ Ticket {_ticket_prefix(t)}-{t.id:04d} updated: {', '.join(changes)}"

    elif tool_name == "search_kb":
        q = f"%{tool_input.get('query', '')}%"
        articles = db.query(KBArticle).filter(
            KBArticle.tenant_id == current_user.tenant_id,
            (KBArticle.title.ilike(q)) | (KBArticle.content.ilike(q))
        ).limit(4).all()
        if not articles: return f"No knowledge base articles found for '{tool_input.get('query')}'."
        return "\n\n".join(f"**{a.title}**: {(a.content or '')[:250]}..." for a in articles)

    elif tool_name == "list_kb_articles":
        limit = min(int(tool_input.get("limit", 8)), 20)
        query = db.query(KBArticle).filter(
            KBArticle.tenant_id == current_user.tenant_id,
            KBArticle.status == "published"
        )
        if tool_input.get("category"):
            query = query.filter(KBArticle.category.ilike(f"%{tool_input['category']}%"))
        articles = query.order_by(KBArticle.view_count.desc()).limit(limit).all()
        if not articles: return "No published knowledge base articles found."
        return "\n".join(f"• {a.title} [{a.category or 'General'}]" for a in articles)

    elif tool_name == "get_asset":
        aid = tool_input.get("asset_id")
        a = db.query(Asset).filter(Asset.id == aid, Asset.tenant_id == current_user.tenant_id).first()
        if not a: return f"Asset #{aid} not found."
        expiry = f"\nExpiry: {a.expiry_date}" if a.expiry_date else ""
        warranty = f"\nWarranty: {a.warranty_expiry}" if getattr(a, 'warranty_expiry', None) else ""
        return (f"Asset: {a.name}\nType: {a.type.value}\nStatus: {a.status.value}\n"
                f"Serial: {a.serial_number or 'N/A'}\nAssigned to: {a.assigned_to_id or 'Unassigned'}"
                f"{expiry}{warranty}")

    elif tool_name == "list_my_assets":
        limit = min(int(tool_input.get("limit", 10)), 20)
        assets = db.query(Asset).filter(
            Asset.tenant_id == current_user.tenant_id,
            Asset.assigned_to_id == current_user.id
        ).limit(limit).all()
        if not assets: return "No assets are assigned to you."
        return "\n".join(f"• #{a.id} {a.name} [{a.type.value}] — {a.status.value}" for a in assets)

    elif tool_name == "check_sla":
        now = datetime.utcnow()
        open_statuses = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS]
        tickets = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            Ticket.status.in_(open_statuses),
            Ticket.sla_resolution_deadline.isnot(None)
        )
        if current_user.role == UserRole.EMPLOYEE:
            tickets = tickets.filter(Ticket.requester_id == current_user.id)
        tickets = tickets.all()
        if not tickets: return "No open tickets with SLA deadlines found."
        overdue = [t for t in tickets if t.sla_resolution_deadline < now]
        warning = [t for t in tickets if t.sla_resolution_deadline >= now and (t.sla_resolution_deadline - now).total_seconds() < 3600*2]
        ok      = [t for t in tickets if t not in overdue and t not in warning]
        lines = []
        if overdue: lines.append(f"⚠️ OVERDUE ({len(overdue)}):\n" + "\n".join(f"  {_ticket_prefix(t)}-{t.id:04d}: {t.title}" for t in overdue[:5]))
        if warning: lines.append(f"⏰ Breaching soon ({len(warning)}):\n" + "\n".join(f"  {_ticket_prefix(t)}-{t.id:04d}: {t.title}" for t in warning[:5]))
        if ok:      lines.append(f"✅ On track: {len(ok)} ticket(s)")
        return "\n\n".join(lines)

    return f"Unknown tool: {tool_name}"


def _run_agentic_loop(messages: list, system: str, db: Session, current_user: User):
    """Run the Claude agentic loop. Returns (final_reply, tool_summary)."""
    import urllib.request as _urllib, urllib.error as _urllib_error, json as _json
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI chatbot is not configured. Please add ANTHROPIC_API_KEY on Render.")

    if not messages:
        raise HTTPException(status_code=400, detail="No messages to send.")

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
        try:
            with _urllib.urlopen(req) as resp:
                response = _json.loads(resp.read().decode())
        except _urllib_error.HTTPError as e:
            error_body = e.read().decode() if e.fp else str(e)
            raise HTTPException(status_code=502, detail=f"Anthropic API error {e.code}: {error_body}")

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
    """
    Non-streaming chat. Body: {message, session_id?, attachment?}
    attachment: {name, media_type, data} where data is base64-encoded
    """
    import json as _json, base64 as _b64
    _check_enterprise(current_user, db)
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    user_message = (data.get("message") or "").strip()
    attachment   = data.get("attachment")  # {name, media_type, data (base64)}

    if not user_message and not attachment:
        raise HTTPException(status_code=400, detail="Message or attachment required.")

    # Build display message for saving (text only)
    display_message = user_message or f"[Attached file: {attachment.get('name', 'file')}]"

    session, is_new = _get_or_create_session(data.get("session_id"), current_user, display_message, db)
    existing_history = _build_anthropic_history(session.id, db)

    db.add(ChatMessage(session_id=session.id, role="user", content=display_message))
    db.flush()

    # Build Anthropic user message content — text + optional file
    user_content = []
    if attachment:
        media_type = attachment.get("media_type", "image/jpeg")
        file_data  = attachment.get("data", "")
        file_name  = attachment.get("name", "file")
        if media_type == "application/pdf":
            user_content.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": file_data},
                "title": file_name,
            })
        elif media_type.startswith("image/"):
            user_content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": file_data},
            })
        else:
            # For Word/other docs — tell Claude what it is
            user_content.append({
                "type": "text",
                "text": f"[The user has attached a file: {file_name} ({media_type}). Unfortunately this file type cannot be read directly — please let the user know.]"
            })

    if user_message:
        user_content.append({"type": "text", "text": user_message})

    if not user_content:
        user_content = [{"type": "text", "text": display_message}]

    history = existing_history + [{"role": "user", "content": user_content}]
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
    attachment   = data.get("attachment")
    if not user_message and not attachment:
        raise HTTPException(status_code=400, detail="Message or attachment required.")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="AI chatbot is not configured.")

    display_message = user_message or f"[Attached file: {attachment.get('name', 'file')}]"

    session, _ = _get_or_create_session(data.get("session_id"), current_user, display_message, db)
    existing_history = _build_anthropic_history(session.id, db)

    db.add(ChatMessage(session_id=session.id, role="user", content=display_message))
    db.flush()
    db.commit()

    session_id    = session.id
    session_title = session.title
    system = _build_system_prompt(current_user, tenant)

    # Build user content with optional attachment
    user_content = []
    if attachment:
        media_type = attachment.get("media_type", "image/jpeg")
        file_data  = attachment.get("data", "")
        file_name  = attachment.get("name", "file")
        if media_type == "application/pdf":
            user_content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": file_data}, "title": file_name})
        elif media_type.startswith("image/"):
            user_content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": file_data}})
        else:
            user_content.append({"type": "text", "text": f"[User attached: {file_name} ({media_type}) — this file type cannot be read directly]"})
    if user_message:
        user_content.append({"type": "text", "text": user_message})
    if not user_content:
        user_content = [{"type": "text", "text": display_message}]

    initial_messages = existing_history + [{"role": "user", "content": user_content}]

    def event_stream():
        import json as _j, urllib.request as _ur
        tool_summary = []
        full_reply   = []
        loop_messages = list(initial_messages)

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
                import urllib.error as _ue
                if isinstance(e, _ue.HTTPError):
                    body = e.read().decode() if e.fp else str(e)
                    yield f"data: {_j.dumps({'type': 'error', 'message': f'Anthropic API error {e.code}: {body}'})}\n\n"
                else:
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
