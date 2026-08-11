"""Login and logout."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from app.auth import (
    GENERIC_LOGIN_FAILURE,
    clear_session,
    issue_session,
    require_writable,
    verify_password,
)
from app.deps import SettingsDep
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(
    body: LoginRequest, response: Response, settings: SettingsDep
) -> Response:
    require_writable(settings)

    if not verify_password(body.password, settings):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_FAILURE)

    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    issue_session(out, settings)
    return out


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(settings: SettingsDep) -> Response:
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session(out, settings)
    return out
