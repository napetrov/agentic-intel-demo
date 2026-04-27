#!/usr/bin/env python3
"""
Flowise compose-mode seeder.

Idempotently provisions the credential + variables that every flow under
config/flowise/flows/*.md expects. Run as a one-shot container from the
docker-compose.flowise.yaml overlay — see that file for wiring.

Why credentials + variables only (no chatflow JSON):
  Flowise's exported chatflow JSON embeds per-node inputAnchors /
  outputAnchors arrays that must match the runtime component registry
  exactly. Hand-authoring that JSON without a live Flowise to export from
  is fragile, and a partial import leaves a broken-canvas flow that's
  harder to debug than building from the .md spec. The flow specs in
  config/flowise/flows/ stay the authoring source of truth; this seeder
  removes the manual "paste these values into Settings" step so the only
  one-time UI work is dropping in the four nodes per the spec.

Idempotency:
  Each create call first GETs the matching collection and skips if a
  record with the target name already exists. Re-running the seeder on a
  warm volume is a no-op.

Failure mode:
  Auth / connectivity failures abort fast (non-zero exit) so the compose
  log surfaces the problem. Schema-evolution failures (e.g. a future
  Flowise version renames a field) log the underlying response and exit
  non-zero — the rest of the stack stays up so you can iterate from the
  Flowise UI directly.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request


# ---- Config from environment -----------------------------------------------

FLOWISE_BASE_URL = os.environ.get("FLOWISE_BASE_URL", "http://flowise:3000").rstrip("/")
FLOWISE_USERNAME = os.environ["FLOWISE_USERNAME"]
FLOWISE_PASSWORD = os.environ["FLOWISE_PASSWORD"]

LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000")
LITELLM_API_KEY = os.environ.get("LITELLM_API_KEY", "sk-demo-not-a-real-key")
CONTROL_PLANE_BASE_URL = os.environ.get(
    "CONTROL_PLANE_BASE_URL", "http://control-plane:8080"
)

# How long to wait for Flowise to answer /api/v1/ping. The compose
# healthcheck already gates this service on `flowise: service_healthy`, but
# treat that as a hint, not a guarantee — the gate fires on the first
# successful probe and the API may still be warming up.
READY_TIMEOUT_SECONDS = 90
READY_POLL_INTERVAL = 2


def _basic_auth_header() -> str:
    raw = f"{FLOWISE_USERNAME}:{FLOWISE_PASSWORD}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _request(method: str, path: str, body: dict | None = None) -> tuple[int, dict | list | None]:
    url = f"{FLOWISE_BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", _basic_auth_header())
    # Flowise 2.2.7 routes /api/v1/* through a single auth middleware: a
    # short whitelist (e.g. /api/v1/ping) bypasses auth, requests carrying
    # `x-request-from: internal` accept Basic Auth, and everything else
    # demands a Bearer API key. /api/v1/credentials and /api/v1/variables
    # are not on the whitelist, so without the internal marker our seed
    # calls would 401. The admin UI sets the same header for its own
    # backend calls.
    req.add_header("x-request-from", "internal")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = resp.read()
            parsed = json.loads(payload) if payload else None
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        # Surface the response body — Flowise puts validation errors in there.
        # Redact for credential-touching paths: the request carried
        # plainDataObj.openAIApiKey, and Flowise's error responses have on
        # occasion echoed parts of the input back to the client. Cheaper to
        # blanket-redact than to inspect every Flowise version's behavior.
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        if "/credentials" in path:
            body_text = "<redacted: credential endpoint response>"
        print(f"[seed] HTTP {e.code} on {method} {path}: {body_text}", file=sys.stderr)
        return e.code, None


def wait_for_ready() -> None:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    last_err = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                f"{FLOWISE_BASE_URL}/api/v1/ping", timeout=3
            ) as resp:
                if resp.status == 200:
                    return
        except Exception as e:  # noqa: BLE001 — network probing is best-effort
            last_err = str(e)
        time.sleep(READY_POLL_INTERVAL)
    raise SystemExit(f"[seed] Flowise not ready after {READY_TIMEOUT_SECONDS}s: {last_err}")


# ---- Variables -------------------------------------------------------------

def _existing_variable(name: str) -> dict | None:
    status, payload = _request("GET", "/api/v1/variables")
    if status != 200 or not isinstance(payload, list):
        return None
    for v in payload:
        if isinstance(v, dict) and v.get("name") == name:
            return v
    return None


def upsert_variable(name: str, value: str) -> None:
    existing = _existing_variable(name)
    if existing and existing.get("value") == value:
        print(f"[seed] variable {name!r} already up-to-date")
        return
    body = {"name": name, "value": value, "type": "static"}
    if existing:
        vid = existing.get("id")
        status, _ = _request("PUT", f"/api/v1/variables/{vid}", body)
        action = "updated"
    else:
        status, _ = _request("POST", "/api/v1/variables", body)
        action = "created"
    if status >= 300:
        raise SystemExit(f"[seed] failed to {action} variable {name!r}: status {status}")
    print(f"[seed] {action} variable {name!r}")


# ---- Credentials -----------------------------------------------------------

CREDENTIAL_NAME = "litellm-openai"
# Flowise 2.x credential discriminator for OpenAI-compatible chat models.
# Used by the ChatOpenAI node when selecting an existing credential.
CREDENTIAL_KIND = "openAIApi"


def _existing_credential(name: str) -> dict | None:
    status, payload = _request("GET", "/api/v1/credentials")
    if status != 200 or not isinstance(payload, list):
        return None
    for c in payload:
        if isinstance(c, dict) and c.get("name") == name:
            return c
    return None


def upsert_credential() -> None:
    existing = _existing_credential(CREDENTIAL_NAME)
    body = {
        "name": CREDENTIAL_NAME,
        "credentialName": CREDENTIAL_KIND,
        # plainDataObj is encrypted by Flowise on write using
        # FLOWISE_SECRETKEY_OVERWRITE. The stored secret never appears in
        # the GET response.
        "plainDataObj": {"openAIApiKey": LITELLM_API_KEY},
    }
    if existing:
        # Always overwrite plainDataObj so a rotated LITELLM_API_KEY in
        # .env propagates on the next `compose up`. The GET response masks
        # the stored secret, so we can't compare to short-circuit — just
        # PUT unconditionally.
        cid = existing.get("id")
        status, _ = _request("PUT", f"/api/v1/credentials/{cid}", body)
        action = "updated"
    else:
        status, _ = _request("POST", "/api/v1/credentials", body)
        action = "created"
    if status >= 300:
        raise SystemExit(f"[seed] failed to {action} credential {CREDENTIAL_NAME!r}: status {status}")
    print(f"[seed] {action} credential {CREDENTIAL_NAME!r}")


# ---- Main ------------------------------------------------------------------

def main() -> int:
    print(f"[seed] target Flowise: {FLOWISE_BASE_URL}")
    wait_for_ready()
    print("[seed] Flowise ready")

    # Variables first — credential creation references nothing, but the
    # ChatOpenAI node's basepath uses {{$vars.LITELLM_BASE_URL}} so the
    # Variables must exist before the user opens any flow.
    upsert_variable("LITELLM_BASE_URL", LITELLM_BASE_URL)
    upsert_variable("CONTROL_PLANE_BASE_URL", CONTROL_PLANE_BASE_URL)

    upsert_credential()

    print(
        "[seed] done. Open http://localhost:3000 and follow "
        "config/flowise/flows/terminal-agent.md to build the flow once; "
        "the credential and variables are already set."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
