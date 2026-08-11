"""Read-only endpoints. No authentication."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.auth import is_authenticated
from app.deps import SessionDep, SettingsDep
from app.schemas import AppSummary, ConfigOut, GraphOut
from app.services import graph as service

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/apps", response_model=list[AppSummary])
async def list_apps(session: SessionDep) -> list[AppSummary]:
    return [
        AppSummary(
            id=app.id,
            key=app.key,
            name=app.name,
            accent=app.accent,
            sort_order=app.sort_order,
            counts=counts,
        )
        for app, counts in await service.list_apps(session)
    ]


@router.get("/apps/{key}/graph", response_model=GraphOut)
async def get_graph(key: str, session: SessionDep) -> GraphOut:
    app, nodes, edges, last_updated = await service.get_graph(session, key)
    return GraphOut(
        app=app, nodes=nodes, edges=edges, last_updated=last_updated
    )


@router.get("/config", response_model=ConfigOut)
async def get_config(request: Request, settings: SettingsDep) -> ConfigOut:
    return ConfigOut(
        readonly=settings.readonly,
        authenticated=is_authenticated(request, settings),
    )
