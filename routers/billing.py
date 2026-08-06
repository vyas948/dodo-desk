"""
Billing — plans, checkout, webhooks router.
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


@router.get("/billing/config")
def billing_config(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Returns billing configuration and current plan/trial status for this tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    limits = get_plan_limits(tenant.plan if tenant else "free")
    trial  = get_trial_status(tenant) if tenant else {"on_trial": False, "trial_days_remaining": None, "trial_expired": False}
    staff_count = db.query(User).filter(
        User.tenant_id == admin.tenant_id,
        User.role.in_(['admin', 'agent', 'super_admin']),
        User.is_active == True,
    ).count()
    max_users = limits.get("max_agents")
    return {
        "plan": tenant.plan if tenant else "free",
        "plan_label": limits.get("label", "Free"),
        "billing_status": getattr(tenant, "billing_status", None) if tenant else None,
        "plan_renews_at": str(tenant.plan_renews_at)[:10] if tenant and getattr(tenant, "plan_renews_at", None) else None,
        "plan_limits": limits,
        "staff_count": staff_count,
        "max_users": max_users,
        "seats_over_limit": max(staff_count - max_users, 0) if max_users is not None else 0,
        **trial,
    }


@router.post("/billing/checkout")
def billing_create_checkout(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Create a Dodo Payments hosted checkout session using the official Python SDK."""
    try:
        plan     = data.get("plan", "essentials")
        interval = data.get("interval", "month")
        print(f"📦 Checkout: plan={plan} interval={interval} admin={admin.email} tenant={admin.tenant_id}")

        if not DODO_API_KEY:
            raise HTTPException(status_code=500, detail="DODO_PAYMENTS_API_KEY is not configured on Render. Please add it.")

        tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

        plan_products = DODO_PRODUCTS.get(plan)
        if not plan_products:
            raise HTTPException(status_code=400, detail=f"Unknown plan: {plan}. Valid plans: {list(DODO_PRODUCTS.keys())}")

        product_id = plan_products.get(interval)
        if not product_id:
            raise HTTPException(status_code=400, detail=f"No product configured for {plan}/{interval}")

        # Count current agents to set initial seat quantity
        current_agents = db.query(User).filter(
            User.tenant_id == tenant.id,
            User.is_active == True,
            User.role.in_(['agent', 'admin', 'super_admin', 'platform_admin'])
        ).count()
        initial_seats = max(1, current_agents)

        # Get addon ID for per-seat billing
        addon_id = DODO_ADDONS.get(plan, {}).get(interval)

        print(f"📦 Checkout: product={product_id} addon={addon_id} seats={initial_seats} "
              f"tenant={tenant.id} plan={plan}/{interval} environment={DODO_ENVIRONMENT}")
        print(f"📊 Seat breakdown: {initial_seats} active agent(s)/admin(s) in tenant {tenant.id}")

        # Use the official Dodo Payments Python SDK
        from dodopayments import DodoPayments
        client = DodoPayments(
            bearer_token=DODO_API_KEY,
            environment=DODO_ENVIRONMENT,
        )

        # Per-seat billing: quantity on base product = number of agents
        # No addon needed at checkout — addons are used for mid-cycle seat changes
        product_cart_item = {"product_id": product_id, "quantity": initial_seats}

        session = client.checkout_sessions.create(
            product_cart=[product_cart_item],
            customer={"email": admin.email, "name": admin.full_name},
            return_url=f"{FRONTEND_URL}/settings?billing=success&plan={plan}",
            metadata={"tenant_id": str(tenant.id), "plan": plan, "interval": interval},
        )

        checkout_url = getattr(session, "checkout_url", None) or getattr(session, "url", None)
        print(f"✅ Dodo checkout session created: {checkout_url}")

        if not checkout_url:
            raise HTTPException(status_code=502, detail=f"Dodo Payments did not return a checkout URL. Session: {session}")

        return {"checkout_url": checkout_url}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Checkout failed: {type(e).__name__}: {str(e)}")


@router.post("/billing/portal")
def billing_customer_portal(db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Return the Dodo Payments customer portal URL for this tenant."""
    business_id = os.getenv("DODO_BUSINESS_ID", "")
    if not business_id:
        raise HTTPException(
            status_code=500,
            detail="DODO_BUSINESS_ID is not configured on Render. Please add it."
        )
    # Correct URL format per Dodo docs:
    # Test: https://test.customer.dodopayments.com/login/{business_id}
    # Live: https://customer.dodopayments.com/login/{business_id}
    if DODO_ENVIRONMENT == "test_mode":
        portal_url = f"https://test.customer.dodopayments.com/login/{business_id}"
    else:
        portal_url = f"https://customer.dodopayments.com/login/{business_id}"

    print(f"✅ Portal URL: {portal_url}")
    return {"url": portal_url}


@router.post("/billing/webhook")
async def billing_webhook(request: Request, db: Session = Depends(get_db)):
    """Receives subscription lifecycle events from Dodo Payments."""
    raw_body  = await request.body()
    signature = request.headers.get("webhook-signature", "")
    timestamp = request.headers.get("webhook-timestamp", "")

    print(f"📦 Dodo webhook received: sig={'yes' if signature else 'no'} ts={timestamp}")
    print(f"📦 Raw body preview: {raw_body.decode()[:300]}")

    # Verify signature only if secret is configured
    if DODO_WEBHOOK_SECRET and signature:
        import hmac as _hmac, base64 as _b64, hashlib as _hs
        signed_payload = f"{timestamp}.{raw_body.decode()}"
        expected = _b64.b64encode(
            _hmac.new(DODO_WEBHOOK_SECRET.encode(), signed_payload.encode(), _hs.sha256).digest()
        ).decode()
        provided = signature.split(",")[1] if "," in signature else signature
        if not _hmac.compare_digest(expected, provided):
            print(f"❌ Webhook signature mismatch. Expected: {expected[:20]}... Got: {provided[:20]}...")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body.decode())
    except Exception as e:
        print(f"❌ Webhook JSON parse error: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type", "")
    data       = event.get("data", {})
    print(f"📦 Dodo event type: '{event_type}'")
    print(f"📦 Dodo event data keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")

    def upgrade_tenant(tenant_id_str, subscription_id, customer_id, status, plan, next_billing=None):
        """Helper to find tenant and update plan."""
        tenant = None
        if tenant_id_str:
            try:
                tenant = db.query(Tenant).filter(Tenant.id == int(tenant_id_str)).first()
            except (ValueError, TypeError):
                pass
        if not tenant and customer_id:
            tenant = db.query(Tenant).filter(Tenant.dodo_customer_id == customer_id).first()
        if not tenant:
            print(f"⚠️ Webhook: no tenant found for tenant_id={tenant_id_str} customer_id={customer_id}")
            return
        old_plan = tenant.plan
        if customer_id:
            tenant.dodo_customer_id = customer_id
        if subscription_id:
            tenant.dodo_subscription_id = subscription_id
        tenant.billing_status = status
        if status in ("active", "trialing", "succeeded"):
            valid = ("essentials", "business", "pro", "enterprise")
            tenant.plan = plan if plan in valid else "essentials"
        elif status in ("cancelled", "failed", "on_hold", "past_due"):
            tenant.plan = "free"
        if next_billing:
            try:
                tenant.plan_renews_at = datetime.fromisoformat(next_billing.replace("Z", "+00:00"))
            except Exception:
                pass
        db.commit()
        print(f"✅ Tenant {tenant.id} ({tenant.name}): plan {old_plan} → {tenant.plan}, status={status}")

    # Handle subscription events
    if event_type in ("subscription.active", "subscription.activated",
                      "subscription.renewed", "subscription.updated",
                      "subscription.created"):
        subscription_id = data.get("subscription_id") or data.get("id")
        customer        = data.get("customer") or {}
        customer_id     = customer.get("customer_id") or data.get("customer_id")
        status          = data.get("status", "active")
        metadata        = data.get("metadata") or {}
        tenant_id_str   = metadata.get("tenant_id")
        plan            = metadata.get("plan", "essentials")
        next_billing    = data.get("next_billing_date") or data.get("current_period_end")
        upgrade_tenant(tenant_id_str, subscription_id, customer_id, status, plan, next_billing)

    # Handle payment.succeeded (fires when checkout completes for subscriptions too)
    elif event_type == "payment.succeeded":
        customer        = data.get("customer") or {}
        customer_id     = customer.get("customer_id") or data.get("customer_id")
        metadata        = data.get("metadata") or {}
        tenant_id_str   = metadata.get("tenant_id")
        plan            = metadata.get("plan", "essentials")
        subscription_id = data.get("subscription_id") or data.get("payment_id")
        upgrade_tenant(tenant_id_str, subscription_id, customer_id, "active", plan)

    elif event_type in ("subscription.cancelled", "subscription.on_hold"):
        subscription_id = data.get("subscription_id") or data.get("id")
        tenant = db.query(Tenant).filter(Tenant.dodo_subscription_id == subscription_id).first()
        if tenant:
            tenant.billing_status = "cancelled"
            tenant.plan = "free"
            db.commit()
            print(f"✅ Tenant {tenant.id} downgraded to free: {event_type}")

    elif event_type == "subscription.plan_changed":
        # Fires after a seat count change — update local record
        subscription_id = data.get("subscription_id") or data.get("id")
        quantity        = data.get("quantity", 1)
        tenant = db.query(Tenant).filter(Tenant.dodo_subscription_id == subscription_id).first()
        if tenant:
            print(f"✅ Seat count confirmed by Dodo: tenant {tenant.id} → {quantity} seats")
            db.commit()

    elif event_type == "payment.failed":
        # Seat update payment failed — log and potentially notify admin
        subscription_id = data.get("subscription_id") or data.get("payment", {}).get("subscription_id")
        customer        = data.get("customer") or {}
        customer_id     = customer.get("customer_id") or data.get("customer_id")
        tenant = None
        if subscription_id:
            tenant = db.query(Tenant).filter(Tenant.dodo_subscription_id == subscription_id).first()
        if not tenant and customer_id:
            tenant = db.query(Tenant).filter(Tenant.dodo_customer_id == customer_id).first()
        if tenant:
            print(f"⚠️ Payment failed for tenant {tenant.id} ({tenant.name}) — subscription may go on hold")
            # Notify tenant admin by email
            try:
                admin = db.query(User).filter(
                    User.tenant_id == tenant.id,
                    User.role.in_(['admin', 'super_admin', 'platform_admin']),
                    User.is_active == True
                ).first()
                if admin:
                    send_email(
                        admin.email,
                        "⚠️ DodoDesk — Payment failed",
                        f"Hi {admin.full_name},\n\n"
                        f"A payment for your DodoDesk subscription failed. "
                        f"Please update your payment method to avoid service interruption.\n\n"
                        f"Update payment: https://customer.dodopayments.com/login/{os.getenv('DODO_BUSINESS_ID', '')}\n\n"
                        f"Thank you.",
                        db=db
                    )
            except Exception as e:
                print(f"⚠️ Failed to send payment failure email: {e}")

    else:
        print(f"📦 Unhandled Dodo event type: {event_type} — ignoring")

    return {"ok": True}

