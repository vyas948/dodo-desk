"""
DodoDesk API — main entry point.
"""

from shared import *
from shared import app

# Register routers
from routers.auth import router as auth_router
from routers.tickets import router as tickets_router
from routers.kb import router as kb_router
from routers.assets import router as assets_router
from routers.changes import router as changes_router
from routers.reports import router as reports_router
from routers.catalog import router as catalog_router
from routers.billing import router as billing_router
from routers.automation import router as automation_router
from routers.admin import router as admin_router
from routers.users import router as users_router
from routers.ai import router as ai_router
from routers.canned import router as canned_router
from routers.core import router as core_router

app.include_router(core_router,       tags=["core"])
app.include_router(auth_router,       tags=["auth"])
app.include_router(tickets_router,    tags=["tickets"])
app.include_router(kb_router,         tags=["kb"])
app.include_router(assets_router,     tags=["assets"])
app.include_router(changes_router,    tags=["changes"])
app.include_router(reports_router,    tags=["reports"])
app.include_router(catalog_router,    tags=["catalog"])
app.include_router(billing_router,    tags=["billing"])
app.include_router(automation_router, tags=["automation"])
app.include_router(admin_router,      tags=["admin"])
app.include_router(users_router,      tags=["users"])
app.include_router(ai_router,         tags=["ai"])
app.include_router(canned_router,     tags=["canned"])

# Rebuild all Pydantic models now that all routers are registered
# This resolves any ForwardRef issues in OpenAPI schema generation
_all_models = [
    TicketCreate, TicketUpdate, TicketOut, CommentCreate, CommentOut,
    KBArticleCreate, KBArticleUpdate, KBArticleOut,
    AssetCreate, AssetUpdate, AssetOut, LinkAssetRequest,
    UserOut, UserCreate, UserUpdate, UserProfileUpdate, PasswordUpdate,
    CannedResponseCreate, CannedResponseUpdate, CannedResponseOut,
    ChangeCreate, ChangeUpdate, ChangeOut,
    ServiceCatalogItemCreate, ServiceCatalogItemOut,
    BulkTicketAction, InboundEmail, CSATSubmit, CSATStats, AttachmentOut,
]
for _m in _all_models:
    try:
        _m.model_rebuild()
    except Exception:
        pass

# Override openapi() to catch schema generation errors gracefully
from fastapi.openapi.utils import get_openapi as _get_openapi

def _safe_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    try:
        schema = _get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        app.openapi_schema = schema
        return schema
    except Exception as e:
        print(f"⚠️ OpenAPI schema generation error: {e}")
        # Return minimal valid schema so /docs still loads
        return {
            "openapi": "3.1.0",
            "info": {"title": "DodoDesk API", "version": "1.0.0"},
            "paths": {}
        }

app.openapi = _safe_openapi
