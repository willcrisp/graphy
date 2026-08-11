"""Login and logout."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import (
    GENERIC_LOGIN_FAILURE,
    clear_session,
    client_key,
    issue_session,
    login_limiter,
    require_writable,
    verify_password,
)
from app.deps import SettingsDep
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(
    body: LoginRequest, request: Request, response: Response, settings: SettingsDep
) -> Response:
    require_writable(settings)

    key = client_key(request)
    # Lock-out and wrong-password produce the same body and status, so a caller
    # cannot tell which one they hit.
    if not login_limiter.allowed(key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_FAILURE)

    if not verify_password(body.password, settings):
        login_limiter.record_failure(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_FAILURE)

    login_limiter.reset(key)
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    issue_session(out, settings)
    return out


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(settings: SettingsDep) -> Response:
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session(out, settings)
    return out
