"""
AI — DodoBot chatbot sessions and streaming router.
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


@router.get("/api/chat/sessions")
def list_chat_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_enterprise(current_user, db)
    sessions = db.query(ChatSession).filter(
        ChatSession.tenant_id == current_user.tenant_id,
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).limit(20).all()
    return [{"id": s.id, "title": s.title, "created_at": s.created_at, "updated_at": s.updated_at}
            for s in sessions]


@router.get("/api/chat/sessions/{session_id}")
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


@router.delete("/api/chat/sessions/{session_id}")
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


@router.post("/api/chat")
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


@router.post("/api/chat/stream", response_class=StreamingResponse, include_in_schema=False)
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
