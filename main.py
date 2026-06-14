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
from passlib.context import CryptContext
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
    created_at = Column(DateTime, server_default=sa_func.now())

    tenant = relationship("Tenant", back_populates="users")
    custom_role = relationship("CustomRole")

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

class CommentOut(BaseModel):
    id: int
    ticket_id: int
    author_id: int
    author_name: str
    body: str
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

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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
    return pwd_context.verify(plain, hashed)

def get_password_hash(password):
    return pwd_context.hash(password)

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
    slack_url = (cfg or {}).get("slack_webhook_url") or SLACK_WEBHOOK_URL
    teams_url = (cfg or {}).get("teams_webhook_url") or TEAMS_WEBHOOK_URL
    payload = json.dumps({"text": message}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    for url, name in [(slack_url, "Slack"), (teams_url, "Teams")]:
        if not url:
            continue
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req) as resp:
                if resp.status not in (200, 204):
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
@app.get("/reset-admin-password")
def reset_admin_password(db: Session = Depends(get_db)):
    """Temporary endpoint — remove after first use."""
    email = os.getenv("SEED_ADMIN_EMAIL", "admin@dodobay.com")
    password = os.getenv("SEED_ADMIN_PASSWORD", "Admin1234")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        users = db.query(User).all()
        return {"error": "User not found", "all_users": [u.email for u in users]}
    user.hashed_password = get_password_hash(password)
    db.commit()
    return {"ok": True, "message": f"Password reset for {email} to {password}"}

@app.get("/reset-admin-password")
def reset_admin_password(db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == os.getenv("SEED_ADMIN_EMAIL", "admin@example.com")).first()
    if not user:
        # try other common emails
        for email in ["admin@example.com", "admin@dodobay.com", "admin@yourdomain.com"]:
            user = db.query(User).filter(User.email == email).first()
            if user:
                break
    if not user:
        return {"error": "No admin user found"}
    user.hashed_password = get_password_hash("NewPass99!")
    db.commit()
    return {"ok": True, "email": user.email, "password": "NewPass99!"}

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
    send_notification(
        f"📩 New {ticket.ticket_type.value}: *{ticket.title}*\n"
        f"From: {requester.full_name if requester else current_user.full_name}{on_behalf_note}\n"
        f"Status: {initial_status.value}\n"
        f"View: {FRONTEND_URL}/tickets/{db_ticket.id}"
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
    tickets = query.order_by(Ticket.created_at.desc()).offset(skip).limit(limit).all()
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
    db_comment = Comment(ticket_id=ticket_id, author_id=current_user.id, body=comment.body)
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    log_ticket_event(db, ticket_id, ticket.tenant_id, current_user.id,
                     action="comment_added",
                     note=f'{comment.body[:120]}{"..." if len(comment.body) > 120 else ""}')
    db.commit()
    if current_user.role in [UserRole.AGENT, UserRole.ADMIN] and ticket.requester_id != current_user.id:
        requester = db.query(User).filter(User.id == ticket.requester_id).first()
        if requester:
            send_email(requester.email,
                       f"New reply on ticket #{ticket.id}: {ticket.title}",
                       f"Agent {current_user.full_name} replied:\n\n{comment.body}\n\nView: {FRONTEND_URL}/tickets/{ticket.id}")
    send_notification(
        f"💬 New comment on ticket #{ticket.id} *{ticket.title}*\n"
        f"By: {current_user.full_name}\n"
        f"Comment: {comment.body[:100]}{'...' if len(comment.body) > 100 else ''}\n"
        f"View: {FRONTEND_URL}/tickets/{ticket.id}"
    )
    return {"id": db_comment.id, "ticket_id": db_comment.ticket_id, "author_id": db_comment.author_id,
            "author_name": current_user.full_name, "body": db_comment.body, "created_at": db_comment.created_at}

@app.get("/tickets/{ticket_id}/comments", response_model=list[CommentOut])
def list_comments(ticket_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not has_permission(current_user, Permission.VIEW_ALL_TICKETS) and ticket.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    comments = db.query(Comment).filter(Comment.ticket_id == ticket_id).all()
    result = []
    for c in comments:
        author = db.query(User).filter(User.id == c.author_id).first()
        result.append({"id": c.id, "ticket_id": c.ticket_id, "author_id": c.author_id,
                       "author_name": author.full_name if author else "Unknown", "body": c.body, "created_at": c.created_at})
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
    }

@app.put("/admin/branding")
def update_branding(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
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
    if data.get("logo_url") and str(data["logo_url"]).startswith("http"):
        tenant.logo_url = data["logo_url"]
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

@app.get("/setup/promote-super-admin")
def promote_super_admin(email: str, db: Session = Depends(get_db)):
    """TEMPORARY one-time setup endpoint — promotes a user to super_admin by email."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return {"error": "User not found"}
    user.role = UserRole.SUPER_ADMIN
    db.commit()
    return {"ok": True, "email": user.email, "role": user.role.value}

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

    tenant.mfa_enabled = bool(data.get("mfa_enabled", False))
    tenant.mfa_required = bool(data.get("mfa_required", False)) if tenant.mfa_enabled else False
    tenant.sso_enabled = bool(data.get("sso_enabled", False))
    tenant.sso_provider = data.get("sso_provider", "google")
    tenant.sso_client_id = data.get("sso_client_id") or None
    if data.get("sso_client_secret"):  # only update if a new value is provided
        tenant.sso_client_secret = data.get("sso_client_secret")
    tenant.sso_domain = data.get("sso_domain") or None
    tenant.sso_tenant_id = data.get("sso_tenant_id") or None

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
    return new_user

@app.post("/admin/users/{user_id}/unlock")
def unlock_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    user = db.query(User).filter(User.id == user_id, User.tenant_id == admin.tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.locked_until = None
    user.failed_login_attempts = 0
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
    if "is_active" in update_data and update_data["is_active"] != user.is_active:
        user.status_changed_at = datetime.utcnow()
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
# TENANT MANAGEMENT (super admin)
# =============================================================================

@app.get("/superadmin/tenants")
def list_tenants(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    result = []
    for t in tenants:
        user_count = db.query(User).filter(User.tenant_id == t.id).count()
        ticket_count = db.query(Ticket).filter(Ticket.tenant_id == t.id).count()
        result.append({
            "id": t.id, "name": t.name, "slug": t.slug,
            "primary_color": t.primary_color, "is_active": t.is_active,
            "support_email": t.support_email, "company_tagline": t.company_tagline,
            "created_at": t.created_at,
            "user_count": user_count, "ticket_count": ticket_count,
        })
    return result

@app.post("/superadmin/tenants")
def create_tenant(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
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

@app.post("/superadmin/tenants/{tenant_id}/logo")
async def upload_tenant_logo(tenant_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
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
    for field in ["name", "support_email", "company_tagline", "primary_color", "accent_color", "is_active"]:
        if field in data:
            setattr(tenant, field, data[field])
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