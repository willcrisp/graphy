"""Single-admin session auth.

The admin password is a plaintext value in the environment, compared with a
constant-time equality check. The session cookie carries no identity beyond
"this browser signed in at time T" — there is one admin, so there is nothing else to carry.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings
from app.deps import SettingsDep

COOKIE_NAME = "blueprint_session"
SESSION_MAX_AGE = 30 * 24 * 60 * 60  # 30 days, in seconds
_SALT = "blueprint-session-v1"
_PAYLOAD = "admin"

GENERIC_LOGIN_FAILURE = "Sign-in failed. Check the password and try again."


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt=_SALT)


def verify_password(password: str, settings: Settings) -> bool:
    return secrets.compare_digest(password, settings.admin_password)


def is_authenticated(request: Request, settings: Settings) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    try:
        payload = _serializer(settings).loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return False
    return payload == _PAYLOAD


def issue_session(response: Response, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _serializer(settings).dumps(_PAYLOAD),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


def clear_session(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


# --- dependencies ----------------------------------------------------------


def require_writable(settings: SettingsDep) -> None:
    """Layer 1 of the read-only switch: the deploy-time kill switch. Checked
    before authentication, so it holds even with a valid session."""
    if settings.readonly:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="This board is published read-only. Editing is disabled.",
        )


def require_admin(request: Request, settings: SettingsDep) -> None:
    if not is_authenticated(request, settings):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to make changes.",
        )
