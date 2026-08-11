"""Single-admin session auth.

The password is only ever present as an argon2 hash in the environment. The
session cookie carries no identity beyond "this browser signed in at time T" —
there is one admin, so there is nothing else to carry.
"""

from __future__ import annotations

import time
from collections import defaultdict

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error
from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings
from app.deps import SettingsDep

COOKIE_NAME = "blueprint_session"
SESSION_MAX_AGE = 30 * 24 * 60 * 60  # 30 days, in seconds
_SALT = "blueprint-session-v1"
_PAYLOAD = "admin"

_hasher = PasswordHasher()

# Deliberately identical for a wrong password and for a locked-out IP, so the
# response body cannot be used to probe either.
GENERIC_LOGIN_FAILURE = "Sign-in failed. Check the password and try again."


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt=_SALT)


def verify_password(password: str, settings: Settings) -> bool:
    try:
        return _hasher.verify(settings.admin_password_hash, password)
    except (Argon2Error, ValueError):
        return False


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


class RateLimiter:
    """Fixed-window, in-memory, per-IP. Resets on restart, which is acceptable
    for a single-admin app and avoids dragging in Redis."""

    def __init__(self, limit: int = 5, window_seconds: int = 15 * 60) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _recent(self, key: str, now: float) -> list[float]:
        fresh = [t for t in self._hits[key] if now - t < self.window]
        self._hits[key] = fresh
        return fresh

    def allowed(self, key: str) -> bool:
        return len(self._recent(key, time.monotonic())) < self.limit

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        self._recent(key, now)
        self._hits[key].append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


login_limiter = RateLimiter()


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
