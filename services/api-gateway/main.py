import os
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from auth import verify_token_with_role

app = FastAPI(title="Oakley Apps API Gateway", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://oakleyapps.com", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TAKEOFF_SERVICE_URL = os.getenv("TAKEOFF_SERVICE_URL", "").rstrip("/")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "version": "0.2.0"}


@app.post("/auth/verify")
async def auth_verify(request: Request):
    token_data = await verify_token_with_role(request.url.path, request)
    return {
        "uid": token_data.get("uid"),
        "email": token_data.get("email"),
        "role": token_data.get("role", "staff"),
    }


# ---------------------------------------------------------------------------
# Vendy proxy  →  takeoff-agent (Cloud Run)
# ---------------------------------------------------------------------------

@app.api_route(
    "/v1/vendy/{path:path}",
    methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
)
async def vendy_proxy(path: str, request: Request) -> Response:
    """Forward all /v1/vendy/* requests to the takeoff-agent service.

    Auth is validated here; user identity is forwarded as trusted headers so
    the downstream service doesn't need its own token validation.
    """
    token_data = await verify_token_with_role(request.url.path, request)

    if not TAKEOFF_SERVICE_URL:
        return Response(
            content='{"detail":"TAKEOFF_SERVICE_URL not configured"}',
            status_code=503,
            media_type="application/json",
        )

    # Build downstream URL preserving query string
    query = request.url.query
    downstream_url = f"{TAKEOFF_SERVICE_URL}/v1/vendy/{path}"
    if query:
        downstream_url = f"{downstream_url}?{query}"

    # Strip hop-by-hop headers before forwarding
    HOP_BY_HOP = {
        "host", "connection", "keep-alive", "proxy-authenticate",
        "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
        "authorization",  # don't forward Firebase token to downstream
    }
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP
    }

    # Inject trusted user identity headers
    forward_headers["X-User-Email"] = token_data.get("email", "")
    forward_headers["X-User-Role"] = token_data.get("role", "staff")
    forward_headers["X-User-UID"] = token_data.get("uid", "")

    body = await request.body()

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.request(
            method=request.method,
            url=downstream_url,
            headers=forward_headers,
            content=body,
        )

    # Stream the response back, filtering hop-by-hop headers
    response_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower() not in {"transfer-encoding", "connection"}
    }

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
        media_type=resp.headers.get("content-type"),
    )


# ---------------------------------------------------------------------------
# MargO placeholder (Phase 2)
# ---------------------------------------------------------------------------

@app.api_route(
    "/v1/margo/{path:path}",
    methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
)
async def margo_proxy(path: str, request: Request) -> Response:
    await verify_token_with_role(request.url.path, request)
    return Response(
        content='{"detail":"MargO agent coming in Phase 2"}',
        status_code=503,
        media_type="application/json",
    )
