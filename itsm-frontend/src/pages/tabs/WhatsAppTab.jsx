# ─────────────────────────────────────────────────────────────────────────────
# PASTE THIS BLOCK INTO main.py
#
# Where: directly AFTER the generate_whatsapp_verify_token() function, i.e. after the line
#     return {"whatsapp_verify_token": tenant.whatsapp_verify_token}
# and BEFORE the line
#     @app.get("/admin/security-config")
#
# Nothing else in main.py changes. Uses only imports/helpers already in the file
# (app, Depends, Session, get_db, get_current_admin_user, Tenant, plan_requires, HTTPException).
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/admin/whatsapp-config/test-message")
def send_whatsapp_test_message(data: dict, db: Session = Depends(get_db), admin: User = Depends(get_current_admin_user)):
    """Sends a real WhatsApp text through the tenant's saved credentials and returns Meta's
    answer verbatim, so a misconfigured token / Phone Number ID shows its exact error on
    screen instead of failing silently in a background thread (which is how agent replies
    and the 'ticket created' confirmation behave by design).

    Always answers HTTP 200 with {"ok": bool, ...} for Meta-side failures, so the frontend
    can display the reason. Meta's error body never contains the access token."""
    import re as _re, json as _json, urllib.request as _urllib, urllib.error as _urllib_error

    tenant = db.query(Tenant).filter(Tenant.id == admin.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    plan_requires("whatsapp", tenant, "WhatsApp ticketing is available on the Business plan and above.")

    if not tenant.whatsapp_phone_number_id or not tenant.whatsapp_access_token:
        raise HTTPException(status_code=400, detail="Save a Phone Number ID and an Access Token first.")

    digits = _re.sub(r"\D", "", str(data.get("to_number") or ""))
    if len(digits) < 8 or len(digits) > 15:
        raise HTTPException(status_code=400, detail="Enter the recipient number in international format, e.g. +230 5xxx xxxx.")

    text = (str(data.get("text") or "").strip() or
            "DodoDesk test message: your WhatsApp connection is working.")[:1000]

    url = f"https://graph.facebook.com/v20.0/{tenant.whatsapp_phone_number_id}/messages"
    payload = _json.dumps({
        "messaging_product": "whatsapp",
        "to": digits,
        "type": "text",
        "text": {"body": text},
    }).encode()
    req = _urllib.Request(url, data=payload, method="POST", headers={
        "Authorization": f"Bearer {tenant.whatsapp_access_token}",
        "Content-Type": "application/json",
    })
    try:
        with _urllib.urlopen(req, timeout=15) as resp:
            body = _json.loads(resp.read().decode() or "{}")
            return {"ok": True, "status": resp.status, "response": body}
    except _urllib_error.HTTPError as e:
        raw = e.read().decode(errors="ignore")
        try:
            parsed = _json.loads(raw)
            err = parsed.get("error", parsed)
        except Exception:
            err = {"message": raw[:500]}
        print(f"⚠️ WhatsApp test message failed for tenant {tenant.id}: HTTP {e.code} — {raw[:300]}")
        return {"ok": False, "status": e.code, "error": err}
    except Exception as e:
        print(f"⚠️ WhatsApp test message failed for tenant {tenant.id}: {e}")
        return {"ok": False, "status": None, "error": {"message": str(e)}}
