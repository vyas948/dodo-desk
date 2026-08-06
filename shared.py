# ====================================================
# Complete ITSM – All Modules + Dark Mode (theme column)
# ====================================================

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, date
import enum
import os
import re
import uuid
import smtplib

# Sentry error monitoring — initialise before anything else

# Rate limiting exports
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

# FastAPI OAuth2
from fastapi.security import OAuth2PasswordRequestForm

# SQLAlchemy engine (for direct access if needed)
from sqlalchemy import create_engine as _create_engine

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
import cloudinary
import cloudinary.uploader
import hmac as hmac_lib

# Cloudinary configuration
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY    = os.getenv("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET", "")
# Set CLOUDINARY_FOLDER_MODE=fixed if your account uses fixed folder mode
# Set CLOUDINARY_FOLDER_MODE=dynamic (default) for newer accounts with dynamic folders
CLOUDINARY_FOLDER_MODE = os.getenv("CLOUDINARY_FOLDER_MODE", "dynamic")

# Product prefix — root folder in Cloudinary for this product.
# ─────────────────────────────────────────────────────────────────────────────
# All files are stored under: {product_prefix}/tenants/{tenant_id}/...
#
# When deploying a second product (e.g. DodoHR) to the same Cloudinary account,
# set CLOUDINARY_PRODUCT_PREFIX=dodohr on that server so files stay separated:
#
#   dodesk/tenants/1/tickets/42/   ← DodoDesk files
#   dodohr/tenants/1/payslips/     ← DodoHR files (future)
#
# To export one tenant's files: search {product_prefix}/tenants/{tenant_id}/*
# in Cloudinary Media Library.
# ─────────────────────────────────────────────────────────────────────────────
CLOUDINARY_PRODUCT_PREFIX = os.getenv("CLOUDINARY_PRODUCT_PREFIX", "dodesk")

def _cloudinary_folder(tenant_id: int, entity_type: str, entity_id: int | str | None = None) -> str:
    """Return a fully-scoped Cloudinary folder path.

    Format: {product_prefix}/tenants/{tenant_id}/{entity_type}[/{entity_id}]

    Examples:
      dodesk/tenants/1/logos/
      dodesk/tenants/1/avatars/
      dodesk/tenants/1/tickets/42/
    """
    base = f"{CLOUDINARY_PRODUCT_PREFIX}/tenants/{tenant_id}/{entity_type}"
    if entity_id is not None:
        base = f"{base}/{entity_id}"
    return base

def _detect_resource_type(filename: str) -> str:
    """Return the Cloudinary resource_type for a given filename."""
    image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}
    ext = os.path.splitext(filename)[1].lower()
    return "image" if ext in image_exts else "raw"

def _configure_cloudinary():
    """Configure the Cloudinary SDK from env vars."""
    cloudinary.config(
        cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME", ""),
        api_key=os.getenv("CLOUDINARY_API_KEY", ""),
        api_secret=os.getenv("CLOUDINARY_API_SECRET", ""),
        secure=True,
    )

# Cache of folders already created this server lifetime — avoids redundant API calls
_cloudinary_folders_created: set = set()

def _ensure_cloudinary_folder(folder_path: str) -> None:
    """Create a Cloudinary folder via the Admin API if it doesn't exist yet.
    POST /folders/:folder with Basic auth (api_key:api_secret).
    Cloudinary requires folders to be explicitly created on newer account types
    before files can be placed in them — uploading with public_id alone isn't enough.
    Folders are created recursively: creating 'a/b/c' also creates 'a' and 'a/b'.
    """
    global _cloudinary_folders_created
    if folder_path in _cloudinary_folders_created:
        return  # already created this server lifetime

    cloud_name  = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    api_key     = os.getenv("CLOUDINARY_API_KEY", "")
    api_secret  = os.getenv("CLOUDINARY_API_SECRET", "")
    if not cloud_name:
        return

    # Build all parent paths so nested folders are created top-down
    # e.g. "dodesk/tenants/1/avatars" → ["dodesk", "dodesk/tenants", ...]
    parts = folder_path.split("/")
    paths_to_create = ["/".join(parts[:i+1]) for i in range(len(parts))]

    creds = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    headers = {
        "Authorization": f"Basic {creds}",
        "Content-Type": "application/json",
    }

    for path in paths_to_create:
        if path in _cloudinary_folders_created:
            continue
        url = f"https://api.cloudinary.com/v1_1/{cloud_name}/folders/{urllib.parse.quote(path, safe='/')}"
        try:
            req = urllib.request.Request(url, data=b"{}", headers=headers, method="POST")
            with urllib.request.urlopen(req) as resp:
                resp.read()
            _cloudinary_folders_created.add(path)
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code == 409 or "already exists" in body.lower():
                # Folder already exists — that's fine
                _cloudinary_folders_created.add(path)
            else:
                print(f"⚠️ Cloudinary folder create failed for '{path}': {e.code} {body[:200]}")
        except Exception as e:
            print(f"⚠️ Cloudinary folder create error for '{path}': {e}")

def upload_to_cloudinary(file_bytes: bytes, public_id: str, folder: str = "dodesk",
                         filename: str = "file") -> str:
    """Upload a file to Cloudinary as authenticated (private) and return the stored public_id.

    Handles both Cloudinary account modes:
    - Dynamic folder mode: use asset_folder for path, public_id = filename only
    - Fixed folder mode: use public_id = full/path/filename

    Returns the public_id exactly as Cloudinary stored it (from the API response).
    """
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    if not cloud_name:
        raise HTTPException(status_code=500, detail="Cloudinary is not configured.")
    _configure_cloudinary()

    if folder:
        _ensure_cloudinary_folder(folder)

    resource_type = _detect_resource_type(filename or public_id)

    # full_public_id = folder/filename — used in fixed folder mode
    full_public_id = f"{folder}/{public_id}" if folder else public_id
    # filename_only — used in dynamic folder mode (no slashes in public_id)
    filename_only = public_id

    import io

    # Try dynamic folder mode first: asset_folder = full path, public_id = filename only
    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(file_bytes),
            public_id=filename_only,     # just the filename — NO path separators
            asset_folder=folder,         # full folder path goes here
            resource_type=resource_type,
            type="authenticated",
            overwrite=True,
            use_filename=False,
            unique_filename=False,
            invalidate=True,
        )
        pid = result.get("public_id") or full_public_id
        # Cloudinary in dynamic mode stores the full path in public_id response
        print(f"✅ Cloudinary upload (dynamic folder): {pid}")
        return pid
    except Exception as e:
        err = str(e)
        print(f"⚠️ Cloudinary dynamic upload failed ({err[:80]}), trying fixed folder mode...")
        # Fallback: fixed folder mode — public_id = full path including folder
        try:
            file_bytes_io = io.BytesIO(file_bytes)
            result = cloudinary.uploader.upload(
                file_bytes_io,
                public_id=full_public_id,   # full path as public_id
                resource_type=resource_type,
                type="authenticated",
                overwrite=True,
                use_filename=False,
                unique_filename=False,
            )
            pid = result.get("public_id") or full_public_id
            print(f"✅ Cloudinary upload (fixed folder): {pid}")
            return pid
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"Cloudinary upload failed: {str(e2)}")

def get_signed_url(public_id: str, resource_type: str = "image",
                   expires_in_seconds: int = 3600) -> str:
    """Generate a time-limited signed URL for a private Cloudinary asset."""
    if not public_id:
        return ""
    _configure_cloudinary()
    import time as _time
    import cloudinary.utils as _cu
    expires_at = int(_time.time()) + expires_in_seconds
    ext = os.path.splitext(public_id)[1].lower().lstrip(".")
    # Auto-detect resource type if not specified
    if resource_type == "auto" or resource_type == "image":
        resource_type = "image" if ext in {"png","jpg","jpeg","gif","webp","svg"} else "raw"
    url, _ = _cu.cloudinary_url(
        public_id,
        resource_type=resource_type,
        type="authenticated",
        sign_url=True,
        expires_at=expires_at,
        secure=True,
        **({"format": ext} if ext and ext in {"png","jpg","jpeg","gif","webp"} else {}),
    )
    return url


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

# Neon PgBouncer: use POOLED_DATABASE_URL if set (port 6543), otherwise use direct connection
# To enable: Neon dashboard → Connection Details → Pooled connection → copy URL → set as POOLED_DATABASE_URL on Render
POOLED_DATABASE_URL = os.getenv("POOLED_DATABASE_URL", SQLALCHEMY_DATABASE_URL)

# Fix URL schemes
for _url_attr in ["SQLALCHEMY_DATABASE_URL", "POOLED_DATABASE_URL"]:
    _val = locals()[_url_attr]
    if _val.startswith("postgres://"):
        locals()[_url_attr] = _val.replace("postgres://", "postgresql://", 1)

if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)
if POOLED_DATABASE_URL.startswith("postgres://"):
    POOLED_DATABASE_URL = POOLED_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs check_same_thread, PostgreSQL does not
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Detect if using Neon's PgBouncer pooled connection (hostname contains -pooler)
    _is_pooled = "-pooler." in POOLED_DATABASE_URL

    engine = create_engine(
        POOLED_DATABASE_URL,
        # PgBouncer transaction mode: disable pre-ping (it uses prepared statements)
        pool_pre_ping=not _is_pooled,
        pool_recycle=300,
        # Neon PgBouncer: keep pool small — pooler manages the actual Postgres connections
        pool_size=3 if _is_pooled else 5,
        max_overflow=7 if _is_pooled else 10,
        pool_timeout=30,
        connect_args={
            "connect_timeout": 10,
            # sslmode is already in the Neon connection URL — don't pass here
            # Neon PgBouncer rejects extra startup parameters
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        },
    )
    print(f"✅ DB engine: {'PgBouncer pooled' if _is_pooled else 'direct'} connection")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# =============================================================================
# SUBSCRIPTION PLANS
# =============================================================================

PLAN_LIMITS = {
    # ── Free ─────────────────────────────────────────────────────────────────
    "free": {
        "label": "Free", "max_agents": 1, "max_assets": 0,
        "ai_chatbot_conversations": 0, "storage_gb_per_agent": 1,
        "trial_days": 14, "trial_max_agents": 3,
        "ticketing": True, "knowledge_base": True, "service_catalog": False,
        "asset_tracking": False, "branding": False, "basic_sla": True,
        "multiple_sla": False, "workflow_automation": False,
        "change_management": False, "problem_management": False, "release_management": False,
        "ai_chatbot": False, "custom_analytics": False, "mfa": False,
        "sso": False, "approval_workflows": False, "audit_log": False, "sandbox": False,
        "price_monthly": 0, "price_annual": 0, "price_per_extra_seat": 0,
        "sla": True, "max_users": 1, "max_tenants": 1, "grace_users": 0,
    },
    # ── Essentials ───────────────────────────────────────────────────────────
    # $15/agent/month · $153/agent/year (15% off)
    "essentials": {
        "label": "Essentials", "max_agents": None, "max_assets": 250,
        "ai_chatbot_conversations": 0, "storage_gb_per_agent": 2,
        "trial_days": 14, "trial_max_agents": 3,
        "ticketing": True, "knowledge_base": True, "service_catalog": True,
        "asset_tracking": True, "branding": True, "basic_sla": True,
        "multiple_sla": False, "workflow_automation": False,
        "change_management": False, "problem_management": False, "release_management": False,
        "ai_chatbot": False, "custom_analytics": False, "mfa": False,
        "sso": False, "approval_workflows": False, "audit_log": False, "sandbox": False,
        "price_monthly": 15, "price_annual": 153, "price_per_extra_seat": 0,
        "sla": True, "max_users": None, "max_tenants": 1, "grace_users": 0,
    },
    # ── Business ─────────────────────────────────────────────────────────────
    # $35/agent/month · $357/agent/year (15% off)
    "business": {
        "label": "Business", "max_agents": None, "max_assets": 1000,
        "ai_chatbot_conversations": 0, "storage_gb_per_agent": 10,
        "trial_days": 14, "trial_max_agents": 3,
        "ticketing": True, "knowledge_base": True, "service_catalog": True,
        "asset_tracking": True, "branding": True, "basic_sla": True,
        "multiple_sla": True, "workflow_automation": True,
        "change_management": False, "problem_management": False, "release_management": False,
        "ai_chatbot": False, "custom_analytics": True, "mfa": True,
        "sso": False, "approval_workflows": True, "audit_log": True, "sandbox": False,
        "price_monthly": 35, "price_annual": 357, "price_per_extra_seat": 0,
        "sla": True, "max_users": None, "max_tenants": 1, "grace_users": 0,
    },
    # ── Pro (Advanced) ────────────────────────────────────────────────────────
    # $65/agent/month · $663/agent/year (15% off)
    "pro": {
        "label": "Pro", "max_agents": None, "max_assets": 5000,
        "ai_chatbot_conversations": 500, "storage_gb_per_agent": 25,
        "trial_days": 14, "trial_max_agents": 3,
        "ticketing": True, "knowledge_base": True, "service_catalog": True,
        "asset_tracking": True, "branding": True, "basic_sla": True,
        "multiple_sla": True, "workflow_automation": True,
        "change_management": True, "problem_management": True, "release_management": True,
        "ai_chatbot": True, "custom_analytics": True, "mfa": True,
        "sso": False, "approval_workflows": True, "audit_log": True, "sandbox": False,
        "price_monthly": 65, "price_annual": 663, "price_per_extra_seat": 0,
        "sla": True, "max_users": None, "max_tenants": 1, "grace_users": 0,
    },
    # ── Enterprise ────────────────────────────────────────────────────────────
    "enterprise": {
        "label": "Enterprise", "max_agents": None, "max_assets": None,
        "ai_chatbot_conversations": None, "storage_gb_per_agent": None,
        "trial_days": None, "trial_max_agents": None,
        "ticketing": True, "knowledge_base": True, "service_catalog": True,
        "asset_tracking": True, "branding": True, "basic_sla": True,
        "multiple_sla": True, "workflow_automation": True,
        "change_management": True, "problem_management": True, "release_management": True,
        "ai_chatbot": True, "custom_analytics": True, "mfa": True,
        "sso": True, "approval_workflows": True, "audit_log": True, "sandbox": True,
        "price_monthly": None, "price_annual": None, "price_per_extra_seat": 0,
        "sla": True, "max_users": None, "max_tenants": None, "grace_users": 0,
    },
}


def _sql_safe_search(term: str) -> str:
    """Escape LIKE special characters in user search input.
    % and _ are wildcards in SQL LIKE/ILIKE — without escaping, a search for
    "50% off" would match any string, and "_test" would match any single char + "test".
    SQLAlchemy's ilike() parameterizes values (no SQL injection), but these
    characters still act as wildcards unless escaped.
    """
    if not term:
        return ""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_plan_limits(plan: str) -> dict:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

def plan_requires(feature: str, tenant, detail: str | None = None):
    """Raise 403 if the tenant's plan doesn't include the given feature.
    Usage: plan_requires('change_management', tenant)
    """
    limits = get_plan_limits(tenant.plan if tenant else "free")
    if not limits.get(feature, False):
        plan_label = limits.get("label", tenant.plan if tenant else "free")
        msg = detail or f"This feature is not available on the {plan_label} plan. Please upgrade to access it."
        raise HTTPException(status_code=403, detail=msg)



def check_tenant_limit(db: Session, admin: "User"):
    """Raise HTTPException if the admin's tenant has reached the plan's max_tenants.
    Only applies to regular admins — super_admin can always create tenants."""
    if str(admin.role) in ("super_admin", "platform_admin"):
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
    """Compute trial status for a tenant.
    A tenant is on trial if:
    - billing_status == 'trialing' AND
    - their plan has trial_days defined AND
    - they are within the trial window since created_at
    Once they subscribe (billing_status = 'active'), trial is over.
    """
    # If already paid/active subscription, not on trial
    billing_status = getattr(tenant, "billing_status", None)
    if billing_status and billing_status not in ("trialing", None):
        return {"on_trial": False, "trial_days_remaining": None, "trial_expired": False, "trial_plan": None}

    limits = get_plan_limits(tenant.plan)
    trial_days = limits.get("trial_days")
    if not trial_days or not tenant.created_at:
        return {"on_trial": False, "trial_days_remaining": None, "trial_expired": False, "trial_plan": None}

    elapsed = datetime.utcnow() - tenant.created_at
    remaining = trial_days - elapsed.days
    return {
        "on_trial": True,
        "trial_days_remaining": max(remaining, 0),
        "trial_expired": remaining <= 0,
        "trial_plan": tenant.plan,       # which plan they're trialling
        "trial_plan_label": limits.get("label", tenant.plan),
    }


def check_user_limit(db: Session, tenant_id: int, additional: int = 1, role: "UserRole | str | None" = None):
    """Raise HTTPException if adding `additional` staff (agent/admin/super_admin) would exceed the plan limit.
    Employees (end-users raising tickets) don't count toward the limit.

    Billing model:
    - Trial: max 3 agents total (trial_max_agents)
    - Free: max 1 agent
    - Paid plans: unlimited agents — billing is per-agent, metered via Dodo Payments
    - On paid plans we allow adding agents freely and notify the billing system
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return

    # Employees never count toward seat limits
    role_value = role.value if isinstance(role, UserRole) else role
    if str(role_value) == "employee":
        return

    limits = get_plan_limits(tenant.plan)

    # Count current agents/admins
    current_count = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.is_active == True,
        User.role.in_(['agent', 'admin', 'super_admin', 'platform_admin'])
    ).count()

    # ── Trial enforcement ──────────────────────────────────────────────────────
    trial = get_trial_status(tenant)
    if trial.get("on_trial"):
        trial_max = limits.get("trial_max_agents", 3)
        if trial_max and current_count + additional > trial_max:
            raise HTTPException(
                status_code=403,
                detail=f"Trial limit reached. You can add up to {trial_max} agents/admins during the 14-day trial. "
                       f"Upgrade to a paid plan to add more."
            )
        return  # within trial limit — allow

    # ── Free plan enforcement ──────────────────────────────────────────────────
    if tenant.billing_status in (None, "trial_expired", "cancelled") or tenant.plan == "free":
        max_users = limits.get("max_users") or limits.get("max_agents")
        if max_users and current_count + additional > max_users:
            raise HTTPException(
                status_code=403,
                detail=f"The Free plan supports {max_users} agent seat. "
                       f"Upgrade to Essentials or higher to add more agents."
            )
        return

    # ── Paid plan: auto-update seat count in Dodo Payments ────────────────────
    if tenant.billing_status == "active":
        new_count = current_count + additional
        # Call Dodo API to update subscription quantity
        success = _update_dodo_seat_count(tenant, new_count)
        if not success:
            # Payment failed — block user creation and show billing page
            portal_url = f"https://{'customer' if DODO_ENVIRONMENT == 'live_mode' else 'test.customer'}.dodopayments.com/login/{os.getenv('DODO_BUSINESS_ID', '')}"
            raise HTTPException(
                status_code=402,
                detail=f"Could not update your subscription for the additional seat. "
                       f"Please check your payment method at {portal_url} and try again."
            )
        return

    # ── Expired/unknown state — apply free plan limits ─────────────────────────
    raise HTTPException(
        status_code=403,
        detail="Your plan has expired. Please renew your subscription to add agents."
    )

# =============================================================================
# ENUMS
# =============================================================================

class UserRole(str, enum.Enum):
    READONLY       = "readonly"        # view only
    EMPLOYEE       = "employee"        # raises tickets only
    AGENT          = "agent"           # resolves tickets
    ADMIN          = "admin"           # manages one tenant
    SUPER_ADMIN    = "super_admin"     # MSP admin — manages their client tenants
    PLATFORM_ADMIN = "platform_admin"  # DodoDesk owner — sees ALL tenants, ALL data

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
    INCIDENT        = "incident"
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
    dodo_customer_id = Column(String, nullable=True)       # was paddle_customer_id
    dodo_subscription_id = Column(String, nullable=True)   # was paddle_subscription_id
    billing_status = Column(String, nullable=True)  # active | past_due | canceled | paused
    plan_renews_at = Column(DateTime, nullable=True)
    # Security settings
    mfa_enabled = Column(Boolean, default=False)       # MFA available for voluntary enrollment
    mfa_required = Column(Boolean, default=False)      # MFA mandatory for all users
    sso_enabled = Column(Boolean, default=False)
    sso_provider = Column(String, default="google")
    sso_client_id = Column(String, nullable=True)
    sso_client_secret = Column(String, nullable=True)
    sso_domain        = Column(String, nullable=True)   # allowed email domain e.g. company.com
    sso_tenant_id     = Column(String, nullable=True)   # Azure tenant ID / IdP SSO URL
    sso_sso_url       = Column(String, nullable=True)   # IdP Single Sign-On URL
    saml_cert         = Column(Text,   nullable=True)   # IdP X.509 certificate (PEM)
    ip_whitelist      = Column(Text,   nullable=True)   # JSON array of allowed CIDRs
    session_timeout_minutes = Column(Integer, nullable=True, default=60)  # JWT expiry override
    max_login_attempts = Column(Integer, nullable=True, default=0)        # 0 = unlimited
    scheduled_reports = Column(Text,   nullable=True)   # JSON config for scheduled reports
    billing_notes     = Column(Text,   nullable=True)   # JSON flags e.g. {"warned_7d": "..."}
    onboarding_emails = Column(Text,   nullable=True)   # JSON tracking onboarding email sends
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
    role = Column(String, default="employee")
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
    pending_email = Column(String, nullable=True)            # new email awaiting confirmation
    email_change_token = Column(String, nullable=True)       # token sent to new email
    email_change_expires_at = Column(DateTime, nullable=True)
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
    ticket_type = Column(String, default="incident")
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    category = Column(String, nullable=True)
    priority = Column(String, default="medium")
    status = Column(String, default="open")
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id", use_alter=True, name="fk_ticket_group"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    sla_response_deadline = Column(DateTime, nullable=True)
    sla_resolution_deadline = Column(DateTime, nullable=True)
    sla_breach_notified_at = Column(DateTime, nullable=True)
    escalated_at = Column(DateTime, nullable=True)
    sla_paused_at = Column(DateTime, nullable=True)    # when SLA timer was paused
    source = Column(String, nullable=True, default="web")  # web, email, api, portal
    sla_paused_elapsed = Column(Float, nullable=True)  # seconds elapsed before pause
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
    applies_to = Column(String, default="all")       # all | incident | service_request | change | asset | kb_article
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
    ticket_type = Column(String, default="incident") # incident | service_request only (changes use /changes module)
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
    custom_fields_data = Column(Text, nullable=True)      # JSON: {field_key: value, ...}
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
    type = Column(String, nullable=False)  # stored as lowercase varchar, not enum
    model = Column(String, nullable=True)                 # e.g. "Dell Latitude 5420" — picked from admin-managed list per type
    serial_number = Column(String, unique=True, nullable=True)
    status = Column(String, default="available")  # stored as lowercase varchar
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
    custom_fields_data = Column(Text, nullable=True)      # JSON: {field_key: value, ...}
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
    asset_type = Column(String, nullable=False)           # stored as lowercase string e.g. "hardware"
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
    stored_filename = Column(String, nullable=False)   # legacy local disk name OR Cloudinary public_id
    url = Column(String, nullable=True)                # Cloudinary secure_url (None = legacy local file)
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
    risk_level = Column(String, default="medium")
    risk_score = Column(Integer, nullable=True)             # 1-25 calculated from impact x likelihood
    status = Column(String, default="draft")
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
    slack_webhook_url  = Column(String, default="")
    teams_webhook_url  = Column(String, default="")
    email_signature = Column(Text, default="")
    email_footer = Column(Text, default="")
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
    model_config = {"extra": "ignore"}   # silently ignore unknown fields from frontend
    title: str
    description: str
    category: str | None = None          # optional — some tenants don't use categories
    priority: TicketPriority = "medium"
    ticket_type: TicketType = "incident"
    on_behalf_of_id: int | None = None
    tags: list[str] = []
    group_id: int | None = None
    due_date: datetime | None = None
    custom_fields_data: dict | None = None
    template_id: int | None = None
    asset_id: int | None = None          # link ticket to an asset at creation time
    impact: str | None = None            # optional impact field
    urgency: str | None = None           # optional urgency field
    assigned_to_id: int | None = None    # explicit agent assignment (overrides round-robin)

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
    model_config = {"extra": "ignore", "from_attributes": True}
    id: int
    ticket_type: str = "incident"
    title: str
    description: str | None = None
    category: str | None = None
    priority: str = "medium"
    status: str = "open"
    requester_id: int | None = None
    requester_name: str = ""
    assigned_to_id: int | None = None
    asset_id: int | None = None
    sla_response_deadline: datetime | None = None
    sla_resolution_deadline: datetime | None = None
    sla_status: str | None = None
    created_at: datetime | None = None
    watchers: list[dict] = []

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
    custom_fields_data: dict | None = None

class KBArticleUpdate(BaseModel):
    model_config = {"extra": "ignore"}
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
    custom_fields_data: dict | None = None



class KBArticleOut(BaseModel):
    id: int
    title: str
    content: str
    category: str | None = None
    folder: str | None = None
    author_id: int | None = None
    author_name: str = "Unknown"
    status: str = "published"
    version: int = 1
    view_count: int = 0
    helpful_count: int = 0
    not_helpful_count: int = 0
    tags: list[str] = []
    visibility: str = "all"
    review_date: datetime | None = None
    sort_order: int = 0
    custom_fields_data: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True

class AssetCreate(BaseModel):
    name: str
    type: str = "hardware"
    model: str | None = None
    serial_number: str | None = None
    status: AssetStatus = "available"
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
    custom_fields_data: dict | None = None

class AssetUpdate(BaseModel):
    name: str | None = None
    type: AssetType | None = None
    model: str | None = None
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
    custom_fields_data: dict | None = None

class AssetOut(BaseModel):
    id: int
    name: str
    type: str = "hardware"
    model: str | None = None
    serial_number: str | None
    status: str = "available"
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
    role: str = "employee"
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

class UserInvite(BaseModel):
    email: str
    full_name: str
    role: UserRole = UserRole.EMPLOYEE
    job_title: str | None = None
    department: str | None = None

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
    url: str | None = None
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
    risk_level: str = "medium"
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
    model_config = {"extra": "ignore", "from_attributes": True}
    id: int
    title: str
    description: str | None = None
    change_type: str = "normal"
    risk_level: str = "medium"
    risk_score: int | None = None
    status: str = "draft"
    requester_id: int | None = None
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
    created_at: datetime | None = None
    updated_at: datetime | None = None

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
    """Build a RFC-compliant otpauth:// URI for QR code generation.
    Both the label and issuer must be percent-encoded for authenticator apps
    (Google Authenticator, Authy, Microsoft Authenticator) to parse correctly.
    Format: otpauth://totp/{issuer}:{account}?secret=X&issuer=X&algorithm=SHA1&digits=6&period=30
    """
    # URL-encode each component individually
    encoded_issuer  = urllib.parse.quote(issuer, safe='')
    encoded_account = urllib.parse.quote(email, safe='')
    label = f"{encoded_issuer}:{encoded_account}"
    params = urllib.parse.urlencode({
        "secret": secret,
        "issuer": issuer,        # issuer param value — raw, urlencode handles it
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30,
    })
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

# Webhook integrations — fallback globals (per-tenant config overrides these)
SLACK_WEBHOOK_URL  = os.getenv("SLACK_WEBHOOK_URL", "")
TEAMS_WEBHOOK_URL  = os.getenv("TEAMS_WEBHOOK_URL", "")

# =============================================================================
# PADDLE BILLING CONFIG
# =============================================================================

# ── Dodo Payments (replacing Paddle) ─────────────────────────────────────────
DODO_API_KEY            = os.getenv("DODO_PAYMENTS_API_KEY", "")
DODO_WEBHOOK_SECRET     = os.getenv("DODO_PAYMENTS_WEBHOOK_SECRET", "")
DODO_API_BASE           = os.getenv("DODO_API_BASE", "https://api.dodopayments.com")  # same URL for test and live
DODO_ENVIRONMENT        = os.getenv("DODO_ENVIRONMENT", "live_mode")  # "test_mode" or "live_mode"

# Product IDs per plan and billing interval
DODO_PRODUCTS = {
    "essentials": {
        "month": os.getenv("DODO_PRICE_ESSENTIALS_MONTHLY", "pdt_0NiG2gfkljCxtSpqXgNQg"),
        "year":  os.getenv("DODO_PRICE_ESSENTIALS_YEARLY",  "pdt_0NiJzTbLZfDW7v4NdDuBF"),
    },
    "business": {
        "month": os.getenv("DODO_PRICE_BUSINESS_MONTHLY", "pdt_0NiK0WaafQE5ilthVt2Vx"),
        "year":  os.getenv("DODO_PRICE_BUSINESS_YEARLY",  "pdt_0NiK1V6gVbN9vocSYhBrc"),
    },
    "pro": {
        "month": os.getenv("DODO_PRICE_PRO_MONTHLY", "pdt_0NiK2AH3V5xLke1ZT0LmP"),
        "year":  os.getenv("DODO_PRICE_PRO_YEARLY",  "pdt_0NiK4FyOdHWijrzrDsMfo"),
    },
}

# Seat add-on IDs — used for per-agent billing via changePlan API
DODO_ADDONS = {
    "essentials": {
        "month": os.getenv("DODO_ADDON_ESSENTIALS_MONTHLY", "adn_0NikooenMHyl2SAs7qTaI"),
        "year":  os.getenv("DODO_ADDON_ESSENTIALS_YEARLY",  "adn_0NikonJrbx1OWYYzaFsIM"),
    },
    "business": {
        "month": os.getenv("DODO_ADDON_BUSINESS_MONTHLY", "adn_0NikomFT4Nu1GA0r3K10V"),
        "year":  os.getenv("DODO_ADDON_BUSINESS_YEARLY",  "adn_0NikoiN1NbrrCLfnIa8wR"),
    },
    "pro": {
        "month": os.getenv("DODO_ADDON_PRO_MONTHLY", "adn_0NikojnarxvEMyCVVSqXu"),
        "year":  os.getenv("DODO_ADDON_PRO_YEARLY",  "adn_0Nikol56JxNhgYa2Wg3pg"),
    },
}

# Log product IDs at startup so you can verify correct IDs are loaded
print(f"📦 Dodo Products loaded ({DODO_ENVIRONMENT}):")
for plan, intervals in DODO_PRODUCTS.items():
    for interval, pid in intervals.items():
        print(f"   {plan}/{interval}: {pid}")

def _update_dodo_seat_count(tenant: "Tenant", new_agent_count: int) -> bool:
    """Call Dodo Payments API to update subscription addon quantity to match agent count.
    Uses seat add-ons (adn_*) so the base subscription stays the same and only
    the per-seat add-on quantity changes — Dodo prorates automatically.
    Returns True if successful, False if payment failed.
    """
    if not tenant.dodo_subscription_id:
        print(f"⚠️ Seat update skipped — tenant {tenant.id} has no dodo_subscription_id")
        return True
    if tenant.billing_status != "active":
        print(f"⚠️ Seat update skipped — billing_status={tenant.billing_status}")
        return True

    api_key  = DODO_API_KEY
    base_url = "https://live.dodopayments.com" if DODO_ENVIRONMENT == "live_mode" else "https://test.dodopayments.com"

    # Detect billing interval
    plan     = (tenant.plan or "essentials").lower()
    interval = "month"
    if tenant.plan_renews_at:
        from datetime import datetime as _dt
        try:
            days = (tenant.plan_renews_at - _dt.utcnow()).days
            if days > 60:
                interval = "year"
        except Exception:
            pass

    # Get addon ID for this plan + interval
    addon_id = DODO_ADDONS.get(plan, {}).get(interval)
    product_id = DODO_PRODUCTS.get(plan, {}).get(interval)

    if not addon_id or not product_id:
        print(f"⚠️ Seat update: no addon_id for plan={plan} interval={interval}")
        return True

    import httpx
    try:
        resp = httpx.post(
            f"{base_url}/subscriptions/{tenant.dodo_subscription_id}/change-plan",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "product_id": product_id,
                "quantity": new_agent_count,             # seats = agent count on base product
                "proration_billing_mode": "prorated_immediately",
                "on_payment_failure": "prevent_change",
            },
            timeout=15.0
        )
        if resp.status_code in (200, 201, 202):
            print(f"✅ Dodo seat update: tenant {tenant.id} ({tenant.name}) → {new_agent_count} seats [{plan}/{interval}]")
            return True
        else:
            print(f"❌ Dodo seat update failed: {resp.status_code} {resp.text[:300]}")
            return False
    except Exception as e:
        print(f"❌ Dodo seat update error: {e}")
        return False


# Anthropic AI chatbot (Enterprise plan)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = "claude-sonnet-4-6"


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
            <p style='margin:0;color:#9ca3af;font-size:12px;'>This email was sent by DodoDesk.</p>
            <p style='margin:6px 0 0 0;color:#9ca3af;font-size:12px;'>If you did not expect this email, please ignore it.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

# Email translations — key phrases in French
EMAIL_TRANSLATIONS = {
    "fr": {
        "view_ticket": "Voir le ticket →",
        "view_now": "Voir maintenant →",
        "subscribe": "S'abonner",
        "go_to_dashboard": "Accéder au tableau de bord →",
        "sla_breach_subject": "⚠ Breach SLA : Ticket #{id} — {title}",
        "sla_breach_cta": "Voir le ticket maintenant →",
        "assigned_subject": "Ticket assigné : #{id} — {title}",
        "assigned_cta": "Voir le ticket →",
        "comment_subject": "Nouveau commentaire : Ticket #{id} — {title}",
        "comment_cta": "Voir le commentaire →",
        "trial_7d_subject": "⏳ Votre essai DodoDesk {plan} se termine dans 7 jours",
        "trial_1d_subject": "🚨 Votre essai DodoDesk {plan} se termine DEMAIN",
        "trial_expired_subject": "Votre essai DodoDesk {plan} est terminé",
        "csat_subject": "Comment s'est passée votre expérience ? — Ticket #{id}",
        "csat_cta": "Donner mon avis →",
        "welcome_subject": "Bienvenue sur DodoDesk, {name} 👋 — commençons",
        "welcome_cta": "Accéder à votre tableau de bord →",
    }
}

def get_user_language(db, email: str) -> str:
    """Look up the language preference for a user by email. Defaults to en."""
    if not db or not email:
        return 'en'
    try:
        from sqlalchemy import text as _t
        row = db.execute(_t("SELECT language FROM users WHERE email=:e LIMIT 1"), {"e": email}).fetchone()
        return (row[0] or 'en') if row else 'en'
    except Exception:
        return 'en'

def translate_email(key: str, lang: str, **kwargs) -> str:
    """Get translated email string, falling back to English key if not found."""
    if lang == 'en' or lang not in EMAIL_TRANSLATIONS:
        return key
    translated = EMAIL_TRANSLATIONS[lang].get(key, key)
    try:
        return translated.format(**kwargs)
    except Exception:
        return translated

def send_email(to: str, subject: str, body: str, cfg: dict = None, cta_url: str = None, cta_label: str = None, db=None, tenant_id: int = None, lang: str = None) -> bool:
    """Send email via Resend API (preferred) or SMTP fallback.
    Returns True if sent, False if all methods failed.
    Never silently swallows failures — always logs the outcome.
    lang: if provided, overrides auto-detection from recipient's profile.
    """
    # Auto-detect language from recipient's profile if not provided
    if not lang and db:
        lang = get_user_language(db, to)
    lang = lang or 'en'
    
    from_addr = (cfg or {}).get("smtp_from") or SMTP_FROM or "DodoDesk <noreply@dodobay.com>"
    reply_to  = (cfg or {}).get("reply_to") or ""

    # Use tenant branding if available
    company_name  = os.getenv("PLATFORM_NAME", "DodoDesk")
    primary_color = os.getenv("PLATFORM_PRIMARY_COLOR", "#059669")
    logo_url      = os.getenv("PLATFORM_LOGO_URL", None)
    support_email = None

    if db and tenant_id:
        try:
            tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
            if tenant:
                company_name  = tenant.name or company_name
                primary_color = tenant.primary_color or primary_color
                logo_url      = tenant.logo_url or logo_url
                support_email = tenant.support_email or None
        except Exception:
            pass
    elif db and cfg and cfg.get("tenant_id"):
        try:
            tenant = db.query(Tenant).filter(Tenant.id == cfg["tenant_id"]).first()
            if tenant:
                company_name  = tenant.name or company_name
                primary_color = tenant.primary_color or primary_color
                logo_url      = tenant.logo_url or logo_url
                support_email = tenant.support_email or None
        except Exception:
            pass

    # Set From display name
    platform_name = os.getenv("PLATFORM_NAME", "DodoDesk")
    if company_name and company_name.lower() not in (platform_name.lower(), "dododesk", "dodo desk"):
        # Client tenant — show their name with DodoDesk attribution
        resend_from_name = f"{company_name} (via DodoDesk)"
    else:
        # DodoDesk itself — just show DodoDesk
        resend_from_name = platform_name
    resend_from_addr = f"{resend_from_name} <{RESEND_FROM.split('<')[-1].rstrip('>') if '<' in RESEND_FROM else 'noreply@dodobay.com'}>"

    # Set Reply-To to tenant's support email if configured
    if support_email and not reply_to:
        reply_to = support_email

    html_body = build_html_email(subject, body, company_name, primary_color, cta_url, cta_label, logo_url)

    # ── Attempt 1: Resend API ─────────────────────────────────────────────
    resend_key = (cfg or {}).get("resend_api_key") or RESEND_API_KEY
    if resend_key:
        import json as _j, http.client as _hc, ssl as _ssl
        candidates = list(dict.fromkeys([resend_from_addr, RESEND_FROM, "DodoDesk <onboarding@resend.dev>"]))
        for from_addr_try in candidates:
            try:
                print(f"\U0001f4e7 Resend: to={to} from={from_addr_try}")
                payload = _j.dumps({
                    "from": from_addr_try, "to": [to],
                    "subject": subject, "html": html_body, "text": body,
                    **({ "reply_to": [reply_to] } if reply_to else {}),
                }).encode()
                ctx  = _ssl.create_default_context()
                conn = _hc.HTTPSConnection("api.resend.com", port=443, timeout=20, context=ctx)
                conn.request("POST", "/emails", body=payload, headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json",
                })
                resp      = conn.getresponse()
                resp_body = resp.read().decode()
                conn.close()
                if resp.status in (200, 201):
                    result = _j.loads(resp_body)
                    print(f"\u2705 Email sent via Resend to {to} id={result.get('id')}")
                    return True
                print(f"\u26a0\ufe0f Resend {resp.status} ({from_addr_try}): {resp_body[:300]}")
            except Exception as e:
                print(f"\u26a0\ufe0f Resend error ({from_addr_try}): {type(e).__name__}: {e}")
        print(f"\u26a0\ufe0f All Resend attempts failed for {to}, trying SMTP...")

    # ── Attempt 2: SMTP ───────────────────────────────────────────────────
    host     = (cfg or {}).get("smtp_host") or SMTP_HOST
    port     = int((cfg or {}).get("smtp_port") or SMTP_PORT or 587)
    user     = (cfg or {}).get("smtp_user") or SMTP_USER
    password = (cfg or {}).get("smtp_pass") or SMTP_PASS

    if not host:
        print(f"\u26a0\ufe0f No email provider configured. Email NOT sent to {to}.")
        print(f"--- Unsent email ---\nTo: {to}\nSubject: {subject}\n{body}\n---")
        return False

    print(f"\U0001f4e7 SMTP: to={to} host={host}:{port}")
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText as _MIMEText
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(_MIMEText(body, "plain"))
    msg.attach(_MIMEText(html_body, "html"))
    try:
        import ssl as _ssl2
        if port == 465:
            ctx = _ssl2.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as server:
                if user: server.login(user, password)
                server.sendmail(from_addr, [to], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo(); server.starttls(); server.ehlo()
                if user: server.login(user, password)
                server.sendmail(from_addr, [to], msg.as_string())
        print(f"\u2705 Email sent via SMTP to {to}")
        return True
    except Exception as e:
        print(f"\u274c SMTP failed for {to}: {type(e).__name__}: {e}")
        return False

def send_email_background(to: str, subject: str, body: str, cta_url: str = None, cta_label: str = None):
    """Non-daemon thread email — survives request completion on Render.
    Use for all critical transactional emails (verification, password reset, invite).
    """
    import threading
    def _run():
        ok = send_email(to, subject, body, cta_url=cta_url, cta_label=cta_label)
        if not ok:
            print(f"\u274c Background email FAILED to {to}: {subject}")
    threading.Thread(target=_run, daemon=False).start()


def send_notification(message: str, cfg: dict = None):
    """Send notification to Slack and/or Teams webhooks.
    Slack expects: {"text": "..."}
    Teams expects: {"type": "message", "attachments": [...]} (Adaptive Card) or legacy {"text": "..."}
    We send the correct format for each.
    """
    slack_url = (cfg or {}).get("slack_webhook_url") or SLACK_WEBHOOK_URL
    teams_url = (cfg or {}).get("teams_webhook_url") or TEAMS_WEBHOOK_URL

    slack_payload = json.dumps({"text": message}).encode("utf-8")

    # Teams payload — supports both legacy MessageCard and new Workflows webhooks
    # New Workflows webhook (post-April 2026) accepts simple text format
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
                    "text": message.replace("<", "&lt;").replace(">", "&gt;"),
                    "wrap": True,
                    "size": "Small",
                    "fontType": "Monospace"
                }]
            }
        }]
    }).encode("utf-8")

    # Also prepare legacy MessageCard format as fallback
    teams_legacy_payload = json.dumps({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": "059669",
        "summary": "DodoDesk Notification",
        "text": message.replace("*", "**")
    }).encode("utf-8")

    tasks = [
        (slack_url, "Slack", slack_payload, None),
        (teams_url, "Teams", teams_payload, teams_legacy_payload),
    ]
    for url, name, payload, fallback_payload in tasks:
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
                    # Try legacy format as fallback for Teams
                    if fallback_payload:
                        req2 = urllib.request.Request(
                            url, data=fallback_payload,
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req2, timeout=10) as resp2:
                            if resp2.status in (200, 202, 204):
                                print(f"✅ {name} notification sent (legacy format)")
                            else:
                                print(f"⚠ {name} notification failed: {resp2.status}")
                    else:
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
        ApprovalWorkflow.ticket_type == str(ticket.ticket_type),
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
    """Create an in-app notification for a user — respects user notification preferences."""
    # Map notification type to preference key
    _TYPE_PREF_MAP = {
        'ticket_assigned':   'ticket_assigned',
        'ticket_commented':  'ticket_commented',
        'ticket_status':     'ticket_status_changed',
        'sla_breach':        'ticket_sla_breach',
        'mention':           'ticket_mentioned',
        'approval_required': 'change_approved',
        'approval_approved': 'change_approved',
        'approval_rejected': 'change_rejected',
    }
    pref_key = _TYPE_PREF_MAP.get(type)
    if pref_key:
        try:
            target_user = db.query(User).filter(User.id == user_id).first()
            if target_user and target_user.notification_prefs:
                prefs = json.loads(target_user.notification_prefs)
                if not prefs.get(pref_key, True):
                    return  # User has disabled this notification
        except Exception:
            pass  # On error, default to sending
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


def pause_sla(ticket: "Ticket") -> None:
    """Pause SLA timers when ticket enters pending state."""
    if ticket.sla_resolution_deadline and not ticket.sla_paused_at:
        now = datetime.utcnow()
        ticket.sla_paused_at = now
        # Store how many seconds have elapsed so far
        if ticket.created_at:
            ticket.sla_paused_elapsed = (now - ticket.created_at).total_seconds()

def resume_sla(ticket: "Ticket", db: "Session" = None, tenant_id: int = None) -> None:
    """Resume SLA timers when ticket leaves pending state."""
    if ticket.sla_paused_at:
        paused_duration = (datetime.utcnow() - ticket.sla_paused_at).total_seconds()
        # Extend deadlines by the paused duration
        if ticket.sla_response_deadline:
            ticket.sla_response_deadline = ticket.sla_response_deadline + timedelta(seconds=paused_duration)
        if ticket.sla_resolution_deadline:
            ticket.sla_resolution_deadline = ticket.sla_resolution_deadline + timedelta(seconds=paused_duration)
        ticket.sla_paused_at = None
        ticket.sla_paused_elapsed = None

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
    if ticket.status in ["resolved", "closed"]:
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
        db.add(Asset(name="Dell Laptop #1", type="hardware", serial_number="SN-001",
                     status="available", notes="15 inch, i7", tenant_id=tenant_id))
        db.add(Asset(name="Microsoft Office License", type="software", serial_number="LIC-001",
                     status="assigned", assigned_to_id=1,
                     license_key="XXXX-XXXX-XXXX", vendor="Microsoft",
                     expiry_date=date.today() + timedelta(days=10), tenant_id=tenant_id))
    # Tickets
    if not db.query(Ticket).first():
        now = datetime.utcnow()
        created_incident = now - timedelta(hours=3)
        resp, reso = compute_sla_deadlines("high", created_incident)
        db.add(Ticket(ticket_type="incident", title="VPN connection issue",
                     description="Unable to connect to VPN from home office.",
                     category="Network", priority="high",
                     status="open", requester_id=1,
                     sla_response_deadline=resp, sla_resolution_deadline=reso,
                     created_at=created_incident, tenant_id=tenant_id))
        created_request = now - timedelta(days=1)
        resp2, reso2 = compute_sla_deadlines("medium", created_request)
        db.add(Ticket(ticket_type="service_request",
                     title="New laptop request",
                     description="I need a developer-grade laptop with 32GB RAM.",
                     category="Hardware", priority="medium",
                     status="pending_approval", requester_id=1,
                     sla_response_deadline=resp2, sla_resolution_deadline=reso2,
                     created_at=created_request, tenant_id=tenant_id))
    # Canned
    if not db.query(CannedResponse).first():
        db.add(CannedResponse(title="Printer offline check",
                              content="Please restart the printer by turning it off and on again.",
                              category="Hardware", author_id=2, tenant_id=tenant_id))
        db.add(CannedResponse(title="Password reset instructions",
                              content="Please visit the forgot password page.",
                              category="Account", author_id=2, tenant_id=tenant_id))
    # Change
    if not db.query(ChangeRequest).first():
        db.add(ChangeRequest(title="Server maintenance reboot",
                             description="Planned reboot of the application server.",
                             risk_level="medium",
                             status="pending_approval",
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
        ticket_val = str(ticket.priority) if ticket.priority else ""
    elif field == "status":
        ticket_val = (str(ticket.status) if hasattr(ticket.status, "value") else str(ticket.status)) if ticket.status else ""
    elif field == "ticket_type":
        ticket_val = str(ticket.ticket_type) if ticket.ticket_type else ""
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
    elif action == "assign_round_robin":
        rr = _round_robin_assign(ticket.tenant_id, ticket.group_id, db)
        if rr:
            ticket.assigned_to_id = rr
    elif action == "assign_to_group" and value:
        ticket.group_id = int(value)
    elif action == "set_priority" and value:
        try:
            ticket.priority = str(value).lower()
        except ValueError:
            pass
    elif action == "set_status" and value:
        try:
            ticket.status = str(value).lower()
            if str(ticket.status) == "resolved":
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
        ticket.status = "closed"
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
                                                Ticket.status.notin_(["resolved", "closed"]))
                for cond in conditions:
                    if cond.get("field") == "hours_since_update":
                        cutoff = datetime.utcnow() - timedelta(hours=int(cond.get("value", 24)))
                        query = query.filter(Ticket.updated_at < cutoff)
                    elif cond.get("field") == "hours_since_created":
                        cutoff = datetime.utcnow() - timedelta(hours=int(cond.get("value", 48)))
                        query = query.filter(Ticket.created_at < cutoff)
                    elif cond.get("field") == "priority":
                        try:
                            query = query.filter(Ticket.priority == str(cond.get("value","")).lower())
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
            Ticket.status == 'pending_user',
            Ticket.updated_at < warning_cutoff,
        ).all()

        for ticket in pending_tickets:
            age_days = (now - ticket.updated_at).days

            if age_days >= 10:
                # Auto-close
                ticket.status = "closed"
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

def _dispatch_scheduled_reports():
    """Runs every hour. Checks all tenants for scheduled reports due to be sent."""
    from datetime import datetime as _dt
    now = _dt.utcnow()
    current_hour = now.strftime("%H:00")
    current_day  = now.strftime("%A").lower()   # e.g. "monday"
    current_date = now.day                       # day of month for monthly

    db = next(get_db())
    try:
        tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
        for tenant in tenants:
            raw = getattr(tenant, "scheduled_reports", None)
            if not raw:
                continue
            try:
                config = json.loads(raw)
            except Exception:
                continue
            if not config.get("enabled"):
                continue
            if not config.get("recipients"):
                continue

            freq = config.get("frequency", "weekly")
            sched_time = config.get("time", "08:00")[:5]  # HH:MM

            if sched_time != current_hour:
                continue

            should_send = False
            if freq == "daily":
                should_send = True
            elif freq == "weekly":
                should_send = (current_day == config.get("day", "monday").lower())
            elif freq == "monthly":
                should_send = (current_date == int(config.get("day_of_month", 1)))

            if should_send:
                try:
                    _send_scheduled_report(tenant.id)
                except Exception as e:
                    print(f"⚠️ Scheduled report dispatch error tenant {tenant.id}: {e}")
    except Exception as e:
        print(f"⚠️ _dispatch_scheduled_reports error: {e}")
    finally:
        db.close()


def send_trial_expiry_warnings():
    """Runs every 12 hours. Sends warning at 7 days and 1 day.
    Uses billing_notes to track sent warnings — prevents duplicates on restarts."""
    try:
        db = SessionLocal()
        now = datetime.utcnow()
        trial_tenants = db.query(Tenant).filter(
            Tenant.is_active == True,
            Tenant.plan.in_(["free", "essentials", "business", "pro"]),
        ).all()

        for tenant in trial_tenants:
            trial = get_trial_status(tenant)
            if not trial.get("on_trial"):
                continue
            days_left = trial.get("trial_days_remaining", 0)
            plan_label = trial.get("trial_plan_label", tenant.plan)
            admin = db.query(User).filter(
                User.tenant_id == tenant.id,
                User.role.in_(["admin", "super_admin", "platform_admin"]),
                User.is_active == True,
            ).first()
            if not admin:
                continue

            # Track sent warnings to avoid duplicates across Render restarts
            try:
                sent_flags = json.loads(tenant.billing_notes or "{}")
            except Exception:
                sent_flags = {}

            upgrade_url = f"{FRONTEND_URL}/settings?tab=billing"

            if 6 <= days_left <= 8 and not sent_flags.get("warned_7d"):
                send_email_background(
                    to=admin.email,
                    subject=f"\u23f3 Your DodoDesk {plan_label} trial ends in 7 days",
                    body=(f"Hi {admin.full_name},\n\nYour DodoDesk {plan_label} trial for {tenant.name} ends in {days_left} days.\n\nSubscribe now to keep all your {plan_label} features.\n\n— The DodoDesk Team"),
                    cta_url=upgrade_url, cta_label=f"Subscribe to {plan_label}",
                )
                sent_flags["warned_7d"] = now.isoformat()
                tenant.billing_notes = json.dumps(sent_flags)
                db.commit()
                print(f"\U0001f4e7 Trial 7-day warning sent: {admin.email} ({tenant.name})")

            elif 0 < days_left <= 2 and not sent_flags.get("warned_1d"):
                send_email_background(
                    to=admin.email,
                    subject=f"\U0001f6a8 Your DodoDesk {plan_label} trial ends TOMORROW",
                    body=(f"Hi {admin.full_name},\n\nYour DodoDesk {plan_label} trial for {tenant.name} ends tomorrow.\n\nSubscribe today to avoid losing access.\n\n— The DodoDesk Team"),
                    cta_url=upgrade_url, cta_label="Subscribe Now",
                )
                sent_flags["warned_1d"] = now.isoformat()
                tenant.billing_notes = json.dumps(sent_flags)
                db.commit()
                print(f"\U0001f4e7 Trial 1-day warning sent: {admin.email} ({tenant.name})")

            elif trial.get("trial_expired") and days_left <= 0 and not sent_flags.get("expired"):
                if tenant.plan != "free":
                    tenant.plan = "free"
                    tenant.billing_status = "trial_expired"
                sent_flags["expired"] = now.isoformat()
                tenant.billing_notes = json.dumps(sent_flags)
                db.commit()
                send_email_background(
                    to=admin.email,
                    subject=f"Your DodoDesk {plan_label} trial has ended",
                    body=(f"Hi {admin.full_name},\n\nYour 14-day trial has ended. Your account is now on the Free plan. Your data is safe — subscribe anytime to restore access.\n\n— The DodoDesk Team"),
                    cta_url=upgrade_url, cta_label="Restore Full Access",
                )
                print(f"\u2b07\ufe0f Trial expired: {tenant.name}")

        db.close()
    except Exception as e:
        print(f"\u26a0\ufe0f send_trial_expiry_warnings error: {e}")


def check_sla_breaches():
    """
    Runs every 5 minutes. Finds tickets that:
    - Are open or in_progress
    - Have breached their resolution deadline
    - Haven't been notified in the last 4 hours (to avoid spam)
    Sends in-app notification + email + Slack/Teams to assigned agent and all admins.
    """
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        notify_cooldown = now - timedelta(hours=4)

        breached = db.query(Ticket).filter(
            Ticket.status.in_(["open","in_progress"]),
            Ticket.sla_resolution_deadline < now,
            (Ticket.sla_breach_notified_at == None) |
            (Ticket.sla_breach_notified_at < notify_cooldown)
        ).all()

        for ticket in breached:
            cfg = get_email_config(db, ticket.tenant_id)
            priority_str = str(ticket.priority).capitalize()
            deadline_str = ticket.sla_resolution_deadline.strftime("%Y-%m-%d %H:%M UTC")
            ticket_url = f"{FRONTEND_URL}/tickets/{ticket.id}"
            notified_ids = set()

            # Notify assigned agent (if any)
            if ticket.assigned_to_id:
                agent = db.query(User).filter(User.id == ticket.assigned_to_id).first()
                if agent:
                    create_notification(db, agent.id, ticket.tenant_id,
                        "sla_breach",
                        f"⚠ SLA Breached — {ticket.title}",
                        f"Ticket #{ticket.id} has exceeded its resolution SLA. Immediate attention required.",
                        f"/tickets/{ticket.id}")
                    _lang = get_user_language(db, agent.email)
                    if _lang == 'fr':
                        _subj = f"⚠ Breach SLA : Ticket #{ticket.id} — {ticket.title}"
                        _body = f"Bonjour {agent.full_name},\n\nLe ticket #{ticket.id} « {ticket.title} » a dépassé son délai de résolution SLA.\nPriorité : {priority_str}\nDate limite : {deadline_str}\n\nVeuillez traiter ce ticket immédiatement."
                        _cta = "Voir le ticket maintenant →"
                    else:
                        _subj = f"⚠ SLA Breach: Ticket #{ticket.id} — {ticket.title}"
                        _body = f"Hi {agent.full_name},\n\nTicket #{ticket.id} \"{ticket.title}\" has breached its SLA resolution deadline.\nPriority: {priority_str}\nDeadline was: {deadline_str}\n\nPlease action this ticket immediately."
                        _cta = "View Ticket Now →"
                    if _user_wants_notif(db, agent.id, 'email_sla_breach'):
                        print(f"📧 SLA breach email to {agent.email}")
                        send_email(agent.email, _subj, _body, cfg,
                        cta_url=ticket_url, cta_label=_cta,
                        db=None, tenant_id=ticket.tenant_id, lang=_lang)
                    notified_ids.add(agent.id)

            # Notify all admins/super_admins/platform_admins
            admins = db.query(User).filter(
                User.tenant_id == ticket.tenant_id,
                User.role.in_(["admin", "super_admin", "platform_admin"]),
                User.is_active == True
            ).all()
            for admin in admins:
                create_notification(db, admin.id, ticket.tenant_id,
                    "sla_breach",
                    f"⚠ SLA Breached — {ticket.title}",
                    f"Ticket #{ticket.id} has exceeded its resolution SLA.",
                    f"/tickets/{ticket.id}")
                if admin.id not in notified_ids:
                    assigned_name = "Unassigned"
                    if ticket.assigned_to_id:
                        try:
                            au = db.query(User).filter(User.id == ticket.assigned_to_id).first()
                            assigned_name = au.full_name if au else "Unassigned"
                        except Exception:
                            pass
                    send_email(admin.email,
                        f"⚠ SLA Breach: Ticket #{ticket.id} — {ticket.title}",
                        f"Hi {admin.full_name},\n\n"
                        f"Ticket #{ticket.id} \"{ticket.title}\" has breached its SLA resolution deadline.\n"
                        f"Priority: {priority_str}\n"
                        f"Deadline was: {deadline_str}\n"
                        f"Assigned to: {assigned_name}\n\n"
                        f"Please ensure this ticket is actioned immediately.",
                        cfg,
                        cta_url=ticket_url,
                        cta_label="View Ticket →",
                        db=None, tenant_id=ticket.tenant_id)
                    notified_ids.add(admin.id)

            # Slack/Teams alert
            send_notification(
                f"⚠ *SLA Breach*: Ticket #{ticket.id} \"{ticket.title}\" "
                f"(Priority: {priority_str}) has exceeded its resolution deadline.",
                cfg
            )

            ticket.sla_breach_notified_at = now
            db.commit()

        if breached:
            print(f"✅ SLA breach check: notified {len(breached)} ticket(s)")

    except Exception as e:
        import traceback; traceback.print_exc()
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
                Ticket.status.in_(['open','in_progress']),
                Ticket.updated_at < idle_cutoff,
                (Ticket.escalated_at == None) | (Ticket.escalated_at < escalation_cooldown)
            )
            if rule.priority:
                query = query.filter(Ticket.priority == str(rule.priority).lower())

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
                    _el = get_user_language(db, new_assignee.email)
                    if _el == 'fr':
                        _es = f"🔺 Ticket escaladé #{ticket.id} : {ticket.title}"
                        _eb = f"Bonjour {new_assignee.full_name},\n\nLe ticket #{ticket.id} « {ticket.title} » vous a été escaladé après {rule.idle_hours}h d'inactivité.\nPriorité : {str(ticket.priority)}"
                        _ec = "Voir le ticket escaladé →"
                    else:
                        _es = f"🔺 Escalated Ticket #{ticket.id}: {ticket.title}"
                        _eb = f'Hi {new_assignee.full_name},\n\nTicket #{ticket.id} "{ticket.title}" has been escalated to you after {rule.idle_hours} hours of inactivity.\nPriority: {str(ticket.priority)}'
                        _ec = "View Escalated Ticket →"
                    send_email(new_assignee.email, _es, _eb, cfg,
                        cta_url=f"{FRONTEND_URL}/tickets/{ticket.id}",
                        cta_label=_ec, db=None, tenant_id=ticket.tenant_id, lang=_el)

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
        'pending_email': 'VARCHAR',
        'email_change_token': 'VARCHAR',
        'email_change_expires_at': 'TIMESTAMP',
        'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
        'mfa_secret': 'VARCHAR',
        'mfa_backup_codes': 'TEXT',
        'email_verified': 'BOOLEAN DEFAULT FALSE',
        'password_reset_token': 'VARCHAR',
        'password_reset_expires_at': 'TIMESTAMP',
        'employee_id': 'VARCHAR',
        'country': 'VARCHAR',
    }

    # CRITICAL: Ensure all User model columns exist before any request is served.
    # If any column is missing, every authenticated endpoint returns 500.
    # Run this synchronously at startup, not deferred.
    try:
        with engine.connect() as conn:
            existing_user_cols = {col['name'] for col in inspector.get_columns('users')}
            critical_cols = {
                'current_session_id': 'VARCHAR',
                'pending_email': 'VARCHAR',
                'email_change_token': 'VARCHAR',
                'email_change_expires_at': 'TIMESTAMP',
                'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
                'mfa_secret': 'VARCHAR',
                'mfa_backup_codes': 'TEXT',
                'email_verified': 'BOOLEAN DEFAULT FALSE',
                'password_reset_token': 'VARCHAR',
                'password_reset_expires_at': 'TIMESTAMP',
                'employee_id': 'VARCHAR',
                'country': 'VARCHAR',
                'status_changed_at': 'TIMESTAMP',
            }
            for col, defn in critical_cols.items():
                if col not in existing_user_cols:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ CRITICAL migration: users.{col} added")
                    existing_user_cols.add(col)
            print(f"✅ User columns verified ({len(existing_user_cols)} total)")
    except Exception as e:
        print(f"⚠️ CRITICAL user column migration error: {e}")

    # Ensure email_configs columns exist
    try:
        with engine.connect() as conn:
            ec_cols = {col['name'] for col in inspector.get_columns('email_configs')}
            for col, defn in [
                ('email_signature',   "TEXT DEFAULT ''"),
                ('email_footer',      "TEXT DEFAULT ''"),
                ('slack_webhook_url', "VARCHAR DEFAULT ''"),
                ('teams_webhook_url', "VARCHAR DEFAULT ''"),
            ]:
                if col not in ec_cols:
                    conn.execute(text(f"ALTER TABLE email_configs ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ CRITICAL migration: email_configs.{col} added")
    except Exception as e:
        print(f"⚠️ email_configs migration error: {e}")

    # Ensure tenants columns exist
    try:
        with engine.connect() as conn:
            t_cols = {col['name'] for col in inspector.get_columns('tenants')}
            for col, defn in [
                ('dodo_customer_id',     'VARCHAR'),
                ('dodo_subscription_id', 'VARCHAR'),
                ('billing_status',       'VARCHAR'),
                ('plan_renews_at',       'TIMESTAMP'),
            ]:
                if col not in t_cols:
                    conn.execute(text(f"ALTER TABLE tenants ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ CRITICAL migration: tenants.{col} added")
    except Exception as e:
        print(f"⚠️ tenants migration error: {e}")


    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='users' AND column_name='current_session_id'"
            )).fetchone()
            if result:
                print("✅ Single-session enforcement: current_session_id column confirmed")
            else:
                # Column missing — add it now
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS current_session_id VARCHAR"))
                conn.commit()
                print("✅ Single-session enforcement: current_session_id column ADDED (was missing)")
    except Exception as e:
        print(f"⚠️ current_session_id check failed: {e}")

    # Run the user column migrations
    try:
        with engine.connect() as conn:
            existing_cols = {col['name'] for col in inspector.get_columns('users')}
            for col, defn in migrations.items():
                if col not in existing_cols:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ Migration: users.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: user columns: {e}")

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
            'sla_paused_at': 'TIMESTAMP',
            'sla_paused_elapsed': 'FLOAT',
            'source': 'VARCHAR DEFAULT \'web\'',
            'sla_paused_elapsed': 'FLOAT',
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

    # Attachments — add url column for Cloudinary storage
    try:
        with engine.connect() as conn:
            att_cols = {col['name'] for col in inspector.get_columns('attachments')}
            if 'url' not in att_cols:
                conn.execute(text("ALTER TABLE attachments ADD COLUMN url VARCHAR"))
                conn.commit()
                print("✅ Migration: attachments.url added")
    except Exception as e:
        print(f"⚠️ Migration: attachments.url: {e}")

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
                ('email_signature',    "TEXT DEFAULT ''"),
                ('email_footer',       "TEXT DEFAULT ''"),
                ('slack_webhook_url',  "VARCHAR DEFAULT ''"),
                ('teams_webhook_url',  "VARCHAR DEFAULT ''"),
            ]:
                if col not in ec_cols:
                    conn.execute(text(f'ALTER TABLE email_configs ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: email_configs.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: email_configs columns: {e}")

    # One-time fix: clean corrupted logo_url values where the API base URL was
    # accidentally prepended to a Cloudinary URL, producing broken URLs like:
    # "https://dodo-desk-api.onrender.comhttps//res.cloudinary.com/..."
    # Also fixes partial Cloudinary public IDs (e.g. "tenant_26_logo") that are
    # missing the full https://res.cloudinary.com/... prefix.
    try:
        cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT id, logo_url FROM tenants WHERE logo_url IS NOT NULL"
            )).fetchall()
            fixed = 0
            for row in rows:
                url = row[1]
                if not url:
                    continue
                clean_url = None
                # Fix 1: double-URL corruption
                if 'cloudinary.com' in url and not url.startswith('https://res.cloudinary.com'):
                    idx = url.find('https://res.cloudinary.com')
                    if idx == -1:
                        idx = url.find('http://res.cloudinary.com')
                    if idx > 0:
                        clean_url = url[idx:]
                # Fix 2: partial public ID (no http/https prefix)
                elif cloud_name and not url.startswith('http') and not url.startswith('/'):
                    clean_url = f"https://res.cloudinary.com/{cloud_name}/image/upload/{url}"
                # Fix 3: relative /logos/ path — can't fix without file, skip
                if clean_url:
                    conn.execute(text("UPDATE tenants SET logo_url = :url WHERE id = :id"),
                                 {"url": clean_url, "id": row[0]})
                    fixed += 1
                    print(f"✅ Migration: fixed logo_url for tenant {row[0]}: {url[:40]} → {clean_url[:60]}")
            if fixed:
                conn.commit()
                print(f"✅ Migration: fixed {fixed} logo_url(s)")
            else:
                print("✅ Migration: no broken logo_url values found")
    except Exception as e:
        print(f"⚠️ Migration: logo_url cleanup: {e}")

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
    except Exception as e:
        print(f"⚠️ Migration: change_requests columns: {e}")

    # Change request enum types — Postgres native enums don't auto-update when the
    # Python enum gains new values, so we must explicitly ALTER TYPE ... ADD VALUE.
    # SQLAlchemy's SAEnum stores the Python enum MEMBER NAME (uppercase, e.g. "DRAFT"),
    # not its .value (lowercase "draft") — so the Postgres enum values must be uppercase
    # to match what SQLAlchemy actually sends on INSERT.
    # Each ADD VALUE must run in its own auto-commit connection (cannot be inside
    # a multi-statement transaction in Postgres).
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            for status_value in ["DRAFT", "IN_REVIEW", "SCHEDULED", "IN_PROGRESS", "CANCELLED", "FAILED"]:
                try:
                    conn.execute(text(f"ALTER TYPE changestatus ADD VALUE IF NOT EXISTS '{status_value}'"))
                    print(f"✅ Migration: changestatus enum value '{status_value}' ensured")
                except Exception as inner_e:
                    print(f"⚠️ Migration: changestatus value '{status_value}': {inner_e}")
    except Exception as e:
        print(f"⚠️ Migration: changestatus enum type: {e}")

    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            try:
                conn.execute(text("ALTER TYPE changerisk ADD VALUE IF NOT EXISTS 'CRITICAL'"))
                print("✅ Migration: changerisk enum value 'CRITICAL' ensured")
            except Exception as inner_e:
                print(f"⚠️ Migration: changerisk value 'CRITICAL': {inner_e}")
    except Exception as e:
        print(f"⚠️ Migration: changerisk enum type: {e}")

    # Backfill any existing changes still on the old default 'pending_approval'
    # status with no explicit submission yet — leave as-is, only new rows default to draft now.

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
                ('custom_fields_data', 'TEXT'),
            ]:
                if col not in asset_cols:
                    conn.execute(text(f'ALTER TABLE assets ADD COLUMN {col} {defn}'))
                    conn.commit()
                    print(f"✅ Migration: assets.{col} added")
    except Exception as e:
        print(f"⚠️ Migration: assets columns: {e}")

    # Asset model options table — admin-managed dropdown per asset type
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS asset_model_options (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    asset_type VARCHAR NOT NULL,
                    label VARCHAR NOT NULL,
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_amo_tenant_type "
                "ON asset_model_options(tenant_id, asset_type)"
            ))
            print("✅ Migration: asset_model_options table ready")
    except Exception as e:
        print(f"⚠️ Migration: asset_model_options table: {e}")

    # Convert ALL enum columns to lowercase VARCHAR — permanent fix for SAEnum case mismatch
    enum_conversions = [
        # (table, column, default_value)
        ('tickets',  'status',      'open'),
        ('tickets',  'priority',    'medium'),
        ('tickets',  'ticket_type', 'incident'),
        ('users',    'role',        'employee'),
        ('changes',  'status',      'draft'),
        ('changes',  'risk_level',  'medium'),
        ('changes',  'change_type', 'normal'),
        ('change_requests',  'status',      'draft'),
        ('change_requests',  'risk_level',  'medium'),
        ('change_requests',  'change_type', 'normal'),
        ('assets',   'type',        'hardware'),
        ('assets',   'status',      'available'),
    ]
    try:
        with engine.begin() as conn:
            for table, col, default in enum_conversions:
                try:
                    col_type = conn.execute(text(
                        f"SELECT data_type FROM information_schema.columns "
                        f"WHERE table_name='{table}' AND column_name='{col}'"
                    )).scalar()
                    if col_type and col_type != 'character varying':
                        conn.execute(text(
                            f"ALTER TABLE {table} ALTER COLUMN {col} "
                            f"TYPE VARCHAR USING lower({col}::text)"
                        ))
                        print(f"✅ Migration: {table}.{col} → VARCHAR (lowercase)")
                except Exception as e:
                    print(f"⚠️ Migration: {table}.{col} conversion: {e}")
    except Exception as e:
        print(f"⚠️ Enum→VARCHAR migration error: {e}")

    # Ensure assets table exists (fallback if Base.metadata.create_all missed it)
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS assets (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    name VARCHAR NOT NULL,
                    type VARCHAR NOT NULL DEFAULT 'hardware',
                    model VARCHAR,
                    serial_number VARCHAR,
                    status VARCHAR NOT NULL DEFAULT 'available',
                    assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    purchase_date DATE,
                    purchase_cost NUMERIC(10,2),
                    vendor VARCHAR,
                    license_key VARCHAR,
                    expiry_date DATE,
                    warranty_expiry DATE,
                    maintenance_date DATE,
                    contract_number VARCHAR,
                    location VARCHAR,
                    notes TEXT,
                    tag_number VARCHAR,
                    quantity INTEGER DEFAULT 1,
                    seats_total INTEGER,
                    seats_used INTEGER DEFAULT 0,
                    parent_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
                    custom_fields_data TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id)"))
            print("✅ Migration: assets table ready")
    except Exception as e:
        print(f"⚠️ Migration: assets table: {e}")

    # Convert assets.type and assets.status from enum to lowercase VARCHAR
    try:
        with engine.begin() as conn:
            type_col = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name='assets' AND column_name='type'"
            )).scalar()
            if type_col and type_col != 'character varying':
                conn.execute(text(
                    "ALTER TABLE assets ALTER COLUMN type TYPE VARCHAR USING lower(type::text)"
                ))
                print("✅ Migration: assets.type converted to VARCHAR (lowercase)")
            status_col = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name='assets' AND column_name='status'"
            )).scalar()
            if status_col and status_col != 'character varying':
                conn.execute(text(
                    "ALTER TABLE assets ALTER COLUMN status TYPE VARCHAR USING lower(status::text)"
                ))
                print("✅ Migration: assets.status converted to VARCHAR (lowercase)")
    except Exception as e:
        print(f"⚠️ assets enum→varchar migration: {e}")

    # Convert asset_model_options.asset_type from enum to varchar (permanent fix for case mismatch)
    try:
        with engine.begin() as conn:
            col_type = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name='asset_model_options' AND column_name='asset_type'"
            )).scalar()
            if col_type and col_type != 'character varying':
                # Convert enum column to varchar, normalising to lowercase
                conn.execute(text(
                    "ALTER TABLE asset_model_options "
                    "ALTER COLUMN asset_type TYPE VARCHAR USING lower(asset_type::text)"
                ))
                print("✅ Migration: asset_model_options.asset_type converted from enum to VARCHAR")
            else:
                print("✅ Migration: asset_model_options.asset_type already VARCHAR")
    except Exception as e:
        print(f"⚠️ asset_model_options varchar migration: {e}")

    # Seed sensible defaults for any tenant that has none yet
    try:
        with engine.begin() as seed_conn:
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
            tenant_ids = [row[0] for row in seed_conn.execute(text("SELECT id FROM tenants")).fetchall()]

            # Get enum values
            try:
                enum_vals = [r[0] for r in seed_conn.execute(text(
                    "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid "
                    "WHERE pg_type.typname = 'assettype'"
                )).fetchall()]
                enum_map = {v.lower(): v for v in enum_vals}
            except Exception:
                enum_map = {}

        for tid in tenant_ids:
            # Use a fresh connection per tenant to avoid aborted transaction bleed
            try:
                with engine.begin() as tconn:
                    existing = tconn.execute(text(
                        "SELECT COUNT(*) FROM asset_model_options WHERE tenant_id = :tid"
                    ), {"tid": tid}).scalar()
                    if existing == 0:
                        seeded = 0
                        for asset_type, labels in DEFAULT_MODEL_OPTIONS.items():
                            db_val = enum_map.get(asset_type.lower(), asset_type)
                            for i, label in enumerate(labels):
                                try:
                                    tconn.execute(text(
                                        "INSERT INTO asset_model_options (tenant_id, asset_type, label, sort_order) "
                                        "VALUES (:tid, :atype::assettype, :label, :sort)"
                                    ), {"tid": tid, "atype": db_val, "label": label, "sort": i})
                                    seeded += 1
                                except Exception:
                                    pass
                        if seeded > 0:
                            print(f"✅ Migration: seeded {seeded} asset model options for tenant {tid}")
            except Exception as e:
                print(f"⚠️ Migration: asset_model_options tenant {tid}: {e}")
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
                ('custom_fields_data', 'TEXT'),
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
            'dodo_customer_id': 'VARCHAR',
            'dodo_subscription_id': 'VARCHAR',
            'billing_status': 'VARCHAR',
            'plan_renews_at': 'TIMESTAMP',
            'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
            'mfa_required': 'BOOLEAN DEFAULT FALSE',
            'sso_enabled': 'BOOLEAN DEFAULT FALSE',
            'sso_provider': "VARCHAR DEFAULT 'google'",
            'sso_client_id': 'VARCHAR',
            'sso_client_secret': 'VARCHAR',
            'sso_domain': 'VARCHAR',
            'sso_sso_url': 'VARCHAR',
            'saml_cert': 'TEXT',
            'ip_whitelist': 'TEXT',
            'session_timeout_minutes': 'INTEGER DEFAULT 60',
            'max_login_attempts': 'INTEGER DEFAULT 0',
            'scheduled_reports': 'TEXT',
            'billing_notes': 'TEXT',
            'onboarding_emails': 'TEXT',
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



# =============================================================================
# ONBOARDING EMAIL SEQUENCE — Day 0, 3, 7, 10
# =============================================================================
def _send_onboarding_sequence():
    """Runs every 6 hours. Sends onboarding emails at Day 0/3/7/10 after signup.
    Uses tenant.onboarding_emails JSON to track which emails have been sent."""
    try:
        db = SessionLocal()
        now = datetime.utcnow()
        FRONTEND = os.getenv("FRONTEND_URL", "https://dododesk.dodobay.com")

        tenants = db.query(Tenant).filter(Tenant.is_active == True).all()

        for tenant in tenants:
            try:
                flags = json.loads(tenant.onboarding_emails or "{}") if tenant.onboarding_emails else {}
            except Exception:
                flags = {}

            admin = db.query(User).filter(
                User.tenant_id == tenant.id,
                User.role.in_(["admin", "super_admin", "platform_admin"]),
                User.is_active == True,
            ).order_by(User.id).first()
            if not admin or not tenant.created_at:
                continue

            days_since = (now - tenant.created_at).days
            name = (admin.full_name or "").split()[0] or "there"
            plan_label = (tenant.plan or "essentials").capitalize()
            days_left = max(0, 14 - days_since)
            ticket_count = db.query(Ticket).filter(Ticket.tenant_id == tenant.id).count()
            user_count = db.query(User).filter(User.tenant_id == tenant.id, User.is_active == True).count()

            # Day 0 — Welcome email (send on day 0 or 1)
            if days_since <= 1 and not flags.get("day0"):
                send_email(
                    to=admin.email,
                    cfg={}, db=None, tenant_id=tenant.id,
                    subject=f"Welcome to DodoDesk, {name} 👋 — let's get you started",
                    body=(
                        f"Hi {name},\n\n"
                        f"Welcome to DodoDesk! Your {plan_label} trial is now active — you have 14 days to explore everything, no credit card needed.\n\n"
                        f"Here are 3 things to do in your first 10 minutes:\n\n"
                        f"1. 🎫  Create your first ticket — click 'New Ticket' in the sidebar and log a real IT issue\n"
                        f"2. 👥  Invite your team — go to Users → Add User to bring in your agents and employees\n"
                        f"3. ⚙️  Set up your branding — add your logo and company colours under Settings → Profile\n\n"
                        f"Your {plan_label} trial includes full access to all features. We're here if you need anything — just reply to this email."
                    ),
                    cta_url=f"{FRONTEND}/",
                    cta_label="Go to your dashboard →",
                )
                flags["day0"] = now.isoformat()
                tenant.onboarding_emails = json.dumps(flags)
                db.commit()
                print(f"📧 Onboarding Day 0 → {admin.email} ({tenant.name})")

            # Day 3 — First ticket check
            elif days_since >= 3 and not flags.get("day3"):
                if ticket_count == 0:
                    subj = f"{name}, have you created your first ticket yet?"
                    body = (
                        f"Hi {name},\n\n"
                        f"You signed up for DodoDesk 3 days ago — we wanted to check in.\n\n"
                        f"Creating your first ticket takes under 60 seconds:\n\n"
                        f"1. Click 'New Ticket' in the sidebar\n"
                        f"2. Choose Incident or Service Request\n"
                        f"3. Fill in the title and description\n"
                        f"4. Hit Submit\n\n"
                        f"Your agents get notified automatically and can start working on it right away.\n\n"
                        f"You have {days_left} days left on your trial — plenty of time to see DodoDesk in action."
                    )
                    cta = "Create your first ticket →"
                    url = f"{FRONTEND}/create-ticket"
                else:
                    subj = f"{name}, great start — {ticket_count} ticket{'s' if ticket_count > 1 else ''} already!"
                    body = (
                        f"Hi {name},\n\n"
                        f"You're off to a great start with {ticket_count} ticket{'s' if ticket_count > 1 else ''} already in DodoDesk.\n\n"
                        f"A few more things worth exploring:\n\n"
                        f"• 📚  Knowledge Base — document solutions so your team can self-serve\n"
                        f"• ⚡  Automation Rules — auto-assign tickets by category or priority\n"
                        f"• 📊  Reports — see how your team is performing in real time\n\n"
                        f"You have {days_left} days left on your {plan_label} trial."
                    )
                    cta = "Explore your dashboard →"
                    url = f"{FRONTEND}/"
                send_email(to=admin.email, subject=subj, body=body, cfg={}, cta_url=url, cta_label=cta, db=None, tenant_id=tenant.id)
                flags["day3"] = now.isoformat()
                tenant.onboarding_emails = json.dumps(flags)
                db.commit()
                print(f"📧 Onboarding Day 3 → {admin.email} ({tenant.name})")

            # Day 7 — Invite your team
            elif days_since >= 7 and not flags.get("day7"):
                if user_count <= 1:
                    body = (
                        f"Hi {name},\n\n"
                        f"One week with DodoDesk — how's it going?\n\n"
                        f"We noticed you haven't invited your team yet. DodoDesk is much more powerful with your whole IT team on board:\n\n"
                        f"• Agents can be assigned tickets and manage their own queue\n"
                        f"• Employees get a self-service portal to raise requests without calling IT\n"
                        f"• Managers get live visibility across the entire team\n\n"
                        f"Inviting your team takes 2 minutes — go to Users → Add User.\n\n"
                        f"You have {days_left} days left on your trial."
                    )
                    cta = "Invite your team now →"
                    url = f"{FRONTEND}/admin/users"
                else:
                    body = (
                        f"Hi {name},\n\n"
                        f"One week in and {user_count} team members already on board — brilliant!\n\n"
                        f"Here are some advanced features worth exploring this week:\n\n"
                        f"• 🔄  Change Management — log and approve IT changes with full CAB workflows\n"
                        f"• 🖥️  Asset Management — track all hardware and software across your organisation\n"
                        f"• 🔗  SSO Integration — connect Google Workspace or Microsoft Entra in Settings → Security\n"
                        f"• 📋  SLA Policies — set response and resolution targets per priority level\n\n"
                        f"You have {days_left} days left on your {plan_label} trial."
                    )
                    cta = "Explore advanced features →"
                    url = f"{FRONTEND}/settings"
                send_email(
                    to=admin.email,
                    cfg={}, db=None, tenant_id=tenant.id,
                    subject=f"One week with DodoDesk, {name} — here's what to try next",
                    body=body, cta_url=url, cta_label=cta,
                )
                flags["day7"] = now.isoformat()
                tenant.onboarding_emails = json.dumps(flags)
                db.commit()
                print(f"📧 Onboarding Day 7 → {admin.email} ({tenant.name})")

            # Day 10 — Trial ending soon
            elif days_since >= 10 and not flags.get("day10"):
                send_email(
                    to=admin.email,
                    cfg={}, db=None, tenant_id=tenant.id,
                    subject=f"⏳ {name}, your DodoDesk trial ends in {days_left} day{'s' if days_left != 1 else ''}",
                    body=(
                        f"Hi {name},\n\n"
                        f"Your DodoDesk {plan_label} trial ends in {days_left} day{'s' if days_left != 1 else ''}.\n\n"
                        f"Here's what you've built so far:\n"
                        f"• {ticket_count} ticket{'s' if ticket_count != 1 else ''} logged\n"
                        f"• {user_count} team member{'s' if user_count != 1 else ''} on board\n\n"
                        f"When your trial ends, your account moves to the Free plan (1 agent only). "
                        f"Subscribe now to keep everything running without interruption.\n\n"
                        f"DodoDesk {plan_label} starts at just $15 per agent per month — less than a coffee a day per agent.\n\n"
                        f"Any questions? Just reply to this email — we read everything."
                    ),
                    cta_url=f"{FRONTEND}/settings?tab=billing",
                    cta_label=f"Subscribe to {plan_label} →",
                )
                flags["day10"] = now.isoformat()
                tenant.onboarding_emails = json.dumps(flags)
                db.commit()
                print(f"📧 Onboarding Day 10 → {admin.email} ({tenant.name})")

        db.close()
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"⚠️ _send_onboarding_sequence error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import threading
    os.makedirs(AVATAR_DIR, exist_ok=True)

    # ── Connect to DB with retry (Neon can be slow on cold start) ─────────────
    import time as _startup_time
    max_retries = 5
    for attempt in range(1, max_retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            print(f"✅ Database connected (attempt {attempt})")
            break
        except Exception as e:
            print(f"⚠️ DB connection attempt {attempt}/{max_retries} failed: {type(e).__name__}: {str(e)[:100]}")
            if attempt < max_retries:
                wait = attempt * 3  # 3s, 6s, 9s, 12s
                print(f"   Retrying in {wait}s...")
                _startup_time.sleep(wait)
            else:
                print("❌ Could not connect to DB after all retries — starting anyway, requests may fail until DB recovers")

    # ── STEP 1: Critical column migrations — run SYNCHRONOUSLY ────────────────
    # These must complete before any request is served.
    # Missing columns cause 500 on every authenticated endpoint.
    try:
        from sqlalchemy import inspect as _inspect, text as _text
        _inspector = _inspect(engine)
        with engine.connect() as conn:
            # User table — all columns the model expects
            u_cols = {c['name'] for c in _inspector.get_columns('users')}
            for col, defn in {
                'current_session_id': 'VARCHAR',
                'pending_email': 'VARCHAR',
                'email_change_token': 'VARCHAR',
                'email_change_expires_at': 'TIMESTAMP',
                'mfa_enabled': 'BOOLEAN DEFAULT FALSE',
                'mfa_secret': 'VARCHAR',
                'mfa_backup_codes': 'TEXT',
                'email_verified': 'BOOLEAN DEFAULT FALSE',
                'password_reset_token': 'VARCHAR',
                'password_reset_expires_at': 'TIMESTAMP',
                'employee_id': 'VARCHAR',
                'country': 'VARCHAR',
                'status_changed_at': 'TIMESTAMP',
            }.items():
                if col not in u_cols:
                    conn.execute(_text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ Critical: users.{col} added")
            # email_configs
            ec_cols = {c['name'] for c in _inspector.get_columns('email_configs')}
            for col, defn in {
                'email_signature': "TEXT DEFAULT ''",
                'email_footer': "TEXT DEFAULT ''",
                'slack_webhook_url': "VARCHAR DEFAULT ''",
                'teams_webhook_url': "VARCHAR DEFAULT ''",
            }.items():
                if col not in ec_cols:
                    conn.execute(_text(f"ALTER TABLE email_configs ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ Critical: email_configs.{col} added")
            # tenants
            t_cols = {c['name'] for c in _inspector.get_columns('tenants')}
            for col, defn in {
                'dodo_customer_id': 'VARCHAR',
                'dodo_subscription_id': 'VARCHAR',
                'billing_status': 'VARCHAR',
                'plan_renews_at': 'TIMESTAMP',
            }.items():
                if col not in t_cols:
                    conn.execute(_text(f"ALTER TABLE tenants ADD COLUMN IF NOT EXISTS {col} {defn}"))
                    conn.commit()
                    print(f"✅ Critical: tenants.{col} added")
        print("✅ Critical column check complete — all required columns present")
    except Exception as e:
        print(f"⚠️ Critical column migration error: {e}")

    # ── STEP 2: Remaining migrations — run in background thread ───────────────
    def _run_migrations_safe():
        try:
            run_migrations()
            # Drop legacy Paddle columns if they still exist
            try:
                from sqlalchemy import text as _t2, inspect as _ins2
                _insp = _ins2(engine)
                tenant_cols = {c['name'] for c in _insp.get_columns('tenants')}
                with engine.begin() as _conn:
                    for col in ['paddle_customer_id', 'paddle_subscription_id']:
                        if col in tenant_cols:
                            _conn.execute(_t2(f"ALTER TABLE tenants DROP COLUMN IF EXISTS {col}"))
                            print(f"✅ Dropped legacy column: tenants.{col}")
            except Exception as e:
                print(f"⚠️ Paddle column cleanup skipped: {e}")
        except Exception as e:
            print(f"⚠️ Migration error (non-fatal): {e}")

    mig_thread = threading.Thread(target=_run_migrations_safe, daemon=False)
    mig_thread.start()

    # Log webhook and billing config status
    print(f"📦 Dodo Environment: {DODO_ENVIRONMENT}")
    print(f"📦 Dodo API Key: {'✅ set' if DODO_API_KEY else '❌ MISSING'}")
    print(f"📦 Dodo Webhook Secret: {'✅ set' if DODO_WEBHOOK_SECRET else '❌ MISSING — webhooks will not verify'}")
    print(f"📦 Dodo Business ID: {os.getenv('DODO_BUSINESS_ID', '❌ MISSING')}")

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
    scheduler.add_job(send_trial_expiry_warnings, 'interval', hours=12, id='trial_expiry_warnings',
                      next_run_time=datetime.utcnow() + timedelta(seconds=180))
    scheduler.add_job(_dispatch_scheduled_reports, 'interval', hours=1, id='scheduled_reports',
                      next_run_time=datetime.utcnow() + timedelta(seconds=210))
    scheduler.add_job(_send_onboarding_sequence, 'interval', hours=6, id='onboarding_emails',
                      next_run_time=datetime.utcnow() + timedelta(seconds=240))
    scheduler.start()
    print("✅ SLA breach + escalation + automation + auto-close + trial warning + scheduled reports + onboarding emails schedulers started")

    yield

    scheduler.shutdown()
    print("SLA breach scheduler stopped")

from fastapi.openapi.utils import get_openapi

app = FastAPI(
    lifespan=lifespan,
    title="DodoDesk API",
    description="""
## DodoDesk ITSM REST API

Full API for DodoDesk — an affordable ITSM platform for IT teams and MSPs.

### Authentication
All protected endpoints require a **Bearer token** in the Authorization header:
```
Authorization: Bearer <your_token>
```

Get a token via `POST /auth/login`.

### Rate Limiting
- Login endpoint: 10 requests per minute per IP
- All other endpoints: no hard limit (fair use policy)

### Multi-tenancy
All data is tenant-scoped. Your token determines which tenant's data you can access.

**Support:** support@dodobay.com  
**Website:** https://www.dodobay.com
    """,
    version="1.0.0",
    contact={
        "name": "DodoBay Support",
        "url": "https://www.dodobay.com",
        "email": "support@dodobay.com",
    },
    license_info={
        "name": "Proprietary",
        "url": "https://dododesk.dodobay.com/terms",
    },
    openapi_tags=[
        {"name": "auth",        "description": "Authentication — login, MFA, SSO, password reset"},
        {"name": "tickets",     "description": "Ticket management — create, update, comment, assign"},
        {"name": "kb",          "description": "Knowledge base articles"},
        {"name": "assets",      "description": "Asset and CMDB management"},
        {"name": "changes",     "description": "Change request management"},
        {"name": "reports",     "description": "Reports and analytics"},
        {"name": "admin",       "description": "Admin — users, SLA, branding, settings"},
        {"name": "billing",     "description": "Billing and subscription management"},
    ],
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
API_URL      = os.getenv("API_URL", "https://dodo-desk-api.onrender.com")

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

    try:
        user = db.query(User).filter(User.email == email).first()
    except Exception as e:
        print(f"⚠️ get_current_user DB error: {e}")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable — please retry in a moment.")

    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is disabled")

    # Single-session enforcement — use getattr to handle missing column gracefully
    try:
        current_sid = getattr(user, "current_session_id", None)
        if current_sid is None:
            # Column exists but no session recorded yet — skip (first login after migration)
            pass
        elif not session_id:
            # Old token with no sid — reject if DB has a session ID
            print(f"⚠️ Session rejected: old token (no sid) for {user.email}")
            raise HTTPException(
                status_code=401,
                detail="Your session has expired. Please log in again."
            )
        elif session_id != current_sid:
            # Token sid doesn't match DB — logged in elsewhere
            print(f"⚠️ Session rejected: sid mismatch for {user.email} (token={session_id[:8]}... db={current_sid[:8]}...)")
            raise HTTPException(
                status_code=401,
                detail="You have been logged out because your account was signed in from another device or browser."
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ Session check error for {user.email}: {e}")
        pass  # column not yet migrated — skip enforcement

    return user


# =============================================================================
# SAML SSO — Single Sign-On via SAML 2.0
# Supports: Google Workspace, Okta, Azure AD, Auth0, and any SAML 2.0 IdP
# =============================================================================

def _get_saml_settings(tenant: "Tenant") -> dict:
    """Build python3-saml settings dict from tenant's SSO configuration."""
    api_url = API_URL.rstrip("/")
    return {
        "strict": True,
        "debug": False,
        "sp": {
            "entityId": f"{api_url}/auth/sso/metadata/{tenant.slug}",
            "assertionConsumerService": {
                "url": f"{api_url}/auth/sso/callback/{tenant.slug}",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": f"{api_url}/auth/sso/logout/{tenant.slug}",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert": "",
            "privateKey": "",
        },
        "idp": {
            "entityId": tenant.sso_client_id or "",
            "singleSignOnService": {
                "url": tenant.sso_sso_url or getattr(tenant, "sso_tenant_id", "") or "",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "singleLogoutService": {
                "url": "",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": getattr(tenant, "saml_cert", "") or tenant.sso_domain or "",
        },
        "security": {
            "nameIdEncrypted": False,
            "authnRequestsSigned": False,
            "logoutRequestSigned": False,
            "logoutResponseSigned": False,
            "signMetadata": False,
            "wantMessagesSigned": False,
            "wantAssertionsSigned": True,
            "wantNameId": True,
            "wantAttributeStatement": False,
            "requestedAuthnContext": False,
            "signatureAlgorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
            "digestAlgorithm": "http://www.w3.org/2001/04/xmlenc#sha256",
        }
    }





# Additional Pydantic models used by routers
class BulkTicketAction(BaseModel):
    ticket_ids: list[int]
    action: str  # assign, status, priority, tag, close, delete
    value: str | None = None  # agent_id, status value, priority, tag name

class InboundEmail(BaseModel):
    to: str | None = None           # recipient address (contains tenant slug)
    from_email: str | None = None   # sender email
    from_name: str | None = None    # sender name
    subject: str | None = None      # email subject → ticket title
    text: str | None = None         # plain text body
    html: str | None = None         # HTML body (fallback)
    message_id: str | None = None   # for threading replies
# =============================================================================
# AUTH DEPENDENCIES (moved here for router access)
# =============================================================================

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

    try:
        user = db.query(User).filter(User.email == email).first()
    except Exception as e:
        print(f"⚠️ get_current_user DB error: {e}")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable — please retry in a moment.")

    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is disabled")

    # Single-session enforcement — use getattr to handle missing column gracefully
    try:
        current_sid = getattr(user, "current_session_id", None)
        if current_sid is None:
            # Column exists but no session recorded yet — skip (first login after migration)
            pass
        elif not session_id:
            # Old token with no sid — reject if DB has a session ID
            print(f"⚠️ Session rejected: old token (no sid) for {user.email}")
            raise HTTPException(
                status_code=401,
                detail="Your session has expired. Please log in again."
            )
        elif session_id != current_sid:
            # Token sid doesn't match DB — logged in elsewhere
            print(f"⚠️ Session rejected: sid mismatch for {user.email} (token={session_id[:8]}... db={current_sid[:8]}...)")
            raise HTTPException(
                status_code=401,
                detail="You have been logged out because your account was signed in from another device or browser."
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ Session check error for {user.email}: {e}")
        pass  # column not yet migrated — skip enforcement

    return user


# =============================================================================
# SAML SSO — Single Sign-On via SAML 2.0
# Supports: Google Workspace, Okta, Azure AD, Auth0, and any SAML 2.0 IdP
# =============================================================================

def get_current_admin_user(current_user: User = Depends(get_current_user)):
    role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    if role not in ('admin', 'super_admin', 'platform_admin'):
        raise HTTPException(status_code=403, detail="Only admins can perform this action")
    return current_user

def _ticket_tenant_filter(query, ticket_id: int, current_user):
    """Filter ticket by ID, allowing platform_admin to access any tenant."""
    role = str(current_user.role)
    if role in ("platform_admin", "super_admin"):
        return query.filter(Ticket.id == ticket_id)
    return query.filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id)


def has_permission(user: User, permission: Permission) -> bool:
    role = user.role.value if hasattr(user.role, 'value') else str(user.role)
    if role in ('admin', 'super_admin', 'platform_admin'):
        return True
    if user.custom_role:
        permissions = json.loads(user.custom_role.permissions)
        return permission.value in permissions
    # Readonly — can view tickets/assets/kb/reports but cannot create or edit anything
    if str(user.role) == "readonly":
        return permission in [
            Permission.VIEW_ALL_TICKETS,
            Permission.VIEW_REPORTS,
        ]
    # Legacy fallback
    if str(user.role) == "agent":
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
    if str(user.role) == "employee":
        return permission in [
            Permission.CREATE_TICKETS,
            Permission.CREATE_CHANGES
        ]
    return False


# Rebuild all Pydantic models to resolve any ForwardRefs
for _model in [TicketCreate, TicketUpdate, TicketOut, CommentCreate, CommentOut,
               KBArticleCreate, KBArticleUpdate, KBArticleOut,
               AssetCreate, AssetUpdate, AssetOut, LinkAssetRequest,
               UserOut, UserCreate, UserUpdate, UserProfileUpdate, PasswordUpdate,
               CannedResponseCreate, CannedResponseUpdate, CannedResponseOut,
               ChangeCreate, ChangeUpdate, ChangeOut,
               ServiceCatalogItemCreate, ServiceCatalogItemOut,
               BulkTicketAction, InboundEmail, CSATSubmit, CSATStats]:
    try:
        _model.model_rebuild()
    except Exception:
        pass


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


def _send_scheduled_report(tenant_id: int):
    """Generate and email the scheduled report for a tenant. Called by APScheduler."""
    from sqlalchemy.orm import Session as _S
    db = next(get_db())
    try:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            return
        raw = getattr(tenant, "scheduled_reports", None)
        if not raw:
            return
        config = json.loads(raw)
        if not config.get("enabled"):
            return
        recipients = config.get("recipients", [])
        if not recipients:
            return

        include = config.get("include", ["summary"])
        sections = []

        # Build report sections
        if "summary" in include:
            from sqlalchemy import text as _t
            row = db.execute(_t(
                "SELECT COUNT(*) FILTER (WHERE status NOT IN ('closed','resolved')) as open_count, "
                "COUNT(*) FILTER (WHERE status='resolved') as resolved_count, "
                "COUNT(*) FILTER (WHERE status='closed') as closed_count, "
                "COUNT(*) as total "
                "FROM tickets WHERE tenant_id=:tid AND created_at > NOW() - INTERVAL '7 days'"
            ), {"tid": tenant_id}).fetchone()
            if row:
                sections.append(
                    f"📊 Ticket Summary (last 7 days)\n"
                    f"  Open: {row[0]}  |  Resolved: {row[1]}  |  Closed: {row[2]}  |  Total: {row[3]}"
                )

        if "sla" in include:
            row2 = db.execute(_t(
                "SELECT COUNT(*) FILTER (WHERE sla_response_breached=true) as r_breach, "
                "COUNT(*) FILTER (WHERE sla_resolution_breached=true) as res_breach, "
                "COUNT(*) as total "
                "FROM tickets WHERE tenant_id=:tid AND created_at > NOW() - INTERVAL '7 days'"
            ), {"tid": tenant_id}).fetchone()
            if row2 and row2[2]:
                r_pct = round((1 - row2[0] / row2[2]) * 100, 1)
                sections.append(
                    f"\n⏱ SLA Performance (last 7 days)\n"
                    f"  Response SLA: {r_pct}%  |  Breaches: {row2[0]} response, {row2[1]} resolution"
                )

        if "agent_workload" in include:
            rows3 = db.execute(_t(
                "SELECT u.full_name, COUNT(*) as cnt "
                "FROM tickets t JOIN users u ON u.id=t.assigned_to_id "
                "WHERE t.tenant_id=:tid AND t.status NOT IN ('closed','resolved') "
                "GROUP BY u.full_name ORDER BY cnt DESC LIMIT 5"
            ), {"tid": tenant_id}).fetchall()
            if rows3:
                lines = "\n".join(f"  {r[0]}: {r[1]} open tickets" for r in rows3)
                sections.append(f"\n👥 Agent Workload (open tickets)\n{lines}")

        body = (
            f"Hi,\n\nHere is your {config.get('frequency', 'weekly')} DodoDesk report "
            f"for {tenant.name}.\n\n"
            + "\n".join(sections) +
            f"\n\nView full reports: {FRONTEND_URL}/reports\n\nDodoDesk"
        )

        notif_cfg = get_email_config(db, tenant_id)
        for recipient in recipients:
            try:
                send_email(
                    recipient,
                    f"📊 DodoDesk {config.get('frequency', 'Weekly').capitalize()} Report — {tenant.name}",
                    body,
                    db=None
                )
            except Exception as e:
                print(f"⚠️ Scheduled report email failed for {recipient}: {e}")

        print(f"✅ Scheduled report sent for tenant {tenant_id} to {len(recipients)} recipient(s)")
    except Exception as e:
        print(f"⚠️ Scheduled report error for tenant {tenant_id}: {e}")
    finally:
        db.close()


# =============================================================================
# EMAIL CONFIGURATION (ADMIN ONLY)
# =============================================================================


def _build_anthropic_history(session_id: int, db: Session) -> list:
    history = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()
    return [{"role": m.role, "content": m.content} for m in history if m.role in ("user", "assistant")]


# ── Session management endpoints ─────────────────────────────────────────


def _build_system_prompt(current_user: User, tenant: Tenant) -> str:
    return f"""You are DodoBot, an AI IT support assistant for {tenant.name} powered by DodoDesk.

You help employees and IT staff with:
- Raising and tracking support tickets
- Searching the knowledge base for solutions
- Looking up asset information
- Answering IT policy and procedure questions

Current user: {current_user.full_name} (role: {(current_(user.role.value if hasattr(user.role, "value") else str(user.role)) if hasattr(current_user.role, "value") else str(current_user.role))})
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


def _check_enterprise(current_user: User, db: Session):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant or tenant.plan != "enterprise":
        raise HTTPException(
            status_code=403,
            detail="The AI assistant is available on the Enterprise plan. Contact us to upgrade."
        )


def _execute_tool(tool_name: str, tool_input: dict, current_user: User, db: Session) -> str:
    import json as _json

    def _ticket_prefix(t):
        return "INC" if t.ticket_type and "incident" in str(t.ticket_type) else "REQ"

    if tool_name == "list_my_tickets":
        status_filter = tool_input.get("status", "all")
        limit = min(int(tool_input.get("limit", 10)), 20)
        query = db.query(Ticket).filter(Ticket.tenant_id == current_user.tenant_id)
        if str(current_user.role) == "employee":
            query = query.filter(Ticket.requester_id == current_user.id)
        if status_filter and status_filter != "all":
            try: query = query.filter(Ticket.status == str(status_filter).lower())
            except ValueError: pass
        tickets = query.order_by(Ticket.created_at.desc()).limit(limit).all()
        if not tickets:
            return f"No tickets found{' with status ' + status_filter if status_filter != 'all' else ''}."
        return "\n".join(f"{_ticket_prefix(t)}-{t.id:04d}: {t.title} [{str(t.status)}] [{str(t.priority)}]" for t in tickets)

    elif tool_name == "search_tickets":
        q = f"%{tool_input.get('query', '')}%"
        tickets = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            (Ticket.title.ilike(q)) | (Ticket.description.ilike(q))
        ).order_by(Ticket.created_at.desc()).limit(5).all()
        if not tickets:
            return f"No tickets found matching '{tool_input.get('query')}'."
        return "\n".join(f"{_ticket_prefix(t)}-{t.id:04d}: {t.title} [{str(t.status)}] [{str(t.priority)}]" for t in tickets)

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
                f"Title: {t.title}\nStatus: {str(t.status)}\nPriority: {str(t.priority)}\n"
                f"Category: {t.category or 'Uncategorised'}\n"
                f"Assigned to: {assignee.full_name if assignee else 'Unassigned'}{sla_info}\n"
                f"Description: {t.description[:300]}")

    elif tool_name == "create_ticket":
        new_t = Ticket(
            tenant_id=current_user.tenant_id, requester_id=current_user.id,
            title=tool_input.get("title", ""), description=tool_input.get("description", ""),
            priority=str(tool_input.get("priority", "medium")).lower(),
            ticket_type=str(tool_input.get("ticket_type", "service_request")).lower(),
            category=tool_input.get("category", "Other"), status="open",
        )
        db.add(new_t); db.commit(); db.refresh(new_t)
        prefix = "INC" if new_t.ticket_type == "incident" else "REQ"
        return f"✅ Ticket created: {prefix}-{new_t.id:04d} — \"{new_t.title}\"\nYou can track it on your dashboard."

    elif tool_name == "update_ticket":
        tid = tool_input.get("ticket_id")
        t = db.query(Ticket).filter(Ticket.id == tid, Ticket.tenant_id == current_user.tenant_id).first()
        if not t: return f"Ticket #{tid} not found."
        changes = []
        if "status" in tool_input and tool_input["status"]:
            try:
                t.status = str(tool_input["status"]).lower()
                changes.append(f"status → {tool_input['status']}")
            except ValueError: pass
        if "priority" in tool_input and tool_input["priority"]:
            try:
                t.priority = str(tool_input["priority"]).lower()
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
            query = query.filter(KBArticle.category.ilike(f"%{_sql_safe_search(tool_input['category'])}%"))
        articles = query.order_by(KBArticle.view_count.desc()).limit(limit).all()
        if not articles: return "No published knowledge base articles found."
        return "\n".join(f"• {a.title} [{a.category or 'General'}]" for a in articles)

    elif tool_name == "get_asset":
        aid = tool_input.get("asset_id")
        a = db.query(Asset).filter(Asset.id == aid, Asset.tenant_id == current_user.tenant_id).first()
        if not a: return f"Asset #{aid} not found."
        expiry = f"\nExpiry: {a.expiry_date}" if a.expiry_date else ""
        warranty = f"\nWarranty: {a.warranty_expiry}" if getattr(a, 'warranty_expiry', None) else ""
        return (f"Asset: {a.name}\nType: {str(a.type)}\nStatus: {str(a.status)}\n"
                f"Serial: {a.serial_number or 'N/A'}\nAssigned to: {a.assigned_to_id or 'Unassigned'}"
                f"{expiry}{warranty}")

    elif tool_name == "list_my_assets":
        limit = min(int(tool_input.get("limit", 10)), 20)
        assets = db.query(Asset).filter(
            Asset.tenant_id == current_user.tenant_id,
            Asset.assigned_to_id == current_user.id
        ).limit(limit).all()
        if not assets: return "No assets are assigned to you."
        return "\n".join(f"• #{a.id} {a.name} [{str(a.type)}] — {str(a.status)}" for a in assets)

    elif tool_name == "check_sla":
        now = datetime.utcnow()
        open_statuses = ["open", "in_progress"]
        tickets = db.query(Ticket).filter(
            Ticket.tenant_id == current_user.tenant_id,
            Ticket.status.in_(open_statuses),
            Ticket.sla_resolution_deadline.isnot(None)
        )
        if str(current_user.role) == "employee":
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


def _get_oauth_redirect_uri(tenant_slug: str) -> str:
    return f"{API_URL}/auth/oauth/callback/{tenant_slug}"


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

# =============================================================================
# CHANGE TASKS
# =============================================================================


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

# =============================================================================
# COLLISION DETECTION — track who is currently viewing a ticket
# =============================================================================
_ticket_viewers = {}  # in-memory presence store: { ticket_id: { user_id: {...} } }


def _round_robin_assign(tenant_id: int, group_id: int | None, db) -> int | None:
    """Round-robin auto-assignment.
    Finds the active agent (or agent in the specified group) who was assigned
    a ticket least recently — ensuring even distribution across the team.
    Returns the user_id to assign to, or None if no agents available.
    """
    # Base query — active agents/admins in this tenant
    agent_query = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.is_active == True,
        User.role.in_(['agent', 'admin']),
    )

    if group_id:
        # Restrict to agents in the specified group
        group_member_ids = db.query(GroupMember.user_id).filter(
            GroupMember.group_id == group_id
        ).subquery()
        agent_query = agent_query.filter(User.id.in_(group_member_ids))

    agents = agent_query.all()
    if not agents:
        return None

    agent_ids = [a.id for a in agents]

    # Find last assignment time for each agent
    from sqlalchemy import func as _func
    last_assignments = db.query(
        Ticket.assigned_to_id,
        _func.max(Ticket.created_at).label("last_assigned_at")
    ).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.assigned_to_id.in_(agent_ids),
    ).group_by(Ticket.assigned_to_id).all()

    # Build a map of agent_id → last assigned time
    last_map = {row.assigned_to_id: row.last_assigned_at for row in last_assignments}

    # Sort agents: those never assigned first (None → earliest), then by oldest assignment
    agents_sorted = sorted(
        agents,
        key=lambda a: last_map.get(a.id) or datetime.min
    )

    selected = agents_sorted[0]
    print(f"✅ Round-robin assigned ticket to {selected.full_name} (id={selected.id})")
    return selected.id


def _user_wants_notif(db, user_id: int, event_key: str) -> bool:
    """Check if user has enabled a notification event. Defaults to True if not set."""
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.notification_prefs:
            return True
        prefs = json.loads(user.notification_prefs)
        return prefs.get(event_key, True)
    except Exception:
        return True


def _safe_json(val):
    if not val: return []
    try: return json.loads(val)
    except Exception: return []
