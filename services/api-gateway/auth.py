import os
import firebase_admin
from firebase_admin import credentials, auth
from fastapi import HTTPException, Request

_app = None


def get_firebase_app():
    global _app
    if _app is None:
        if firebase_admin._apps:
            _app = firebase_admin.get_app()
        else:
            project_id = os.environ.get("FIREBASE_PROJECT_ID", "oakley-apps")
            _app = firebase_admin.initialize_app(options={"projectId": project_id})
    return _app


ROLE_ROUTE_MAP: dict[str, list[str]] = {
    "/v1/vendy": ["admin", "management", "pm"],
    "/v1/margo": ["admin", "management", "pm"],
}


def get_required_roles(path: str) -> list[str] | None:
    for prefix, roles in ROLE_ROUTE_MAP.items():
        if path.startswith(prefix):
            return roles
    return None


def _extract_bearer(request: Request) -> str:
    """Pull the Bearer token out of the Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    return auth_header[7:].strip()


async def verify_token(request: Request) -> dict:
    get_firebase_app()
    token = _extract_bearer(request)
    try:
        decoded = auth.verify_id_token(token)
        return decoded
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")


async def verify_token_with_role(path: str, request: Request) -> dict:
    decoded = await verify_token(request)
    required_roles = get_required_roles(path)
    if required_roles is not None:
        user_role = decoded.get("role", "staff")
        if user_role not in required_roles:
            raise HTTPException(status_code=403, detail="Forbidden")
    return decoded
