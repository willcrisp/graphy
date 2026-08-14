"""Read-only endpoints. No authentication."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from app.auth import is_authenticated
from app.deps import SessionDep, SettingsDep
from app.instructions import render as render_instructions
from app.schemas import (
    AppSummary,
    ConfigOut,
    GraphOut,
    MilestoneOut,
    OverviewOut,
    ParentOut,
)
from app.services import graph as service

router = APIRouter(prefix="/api", tags=["public"])


class MarkdownResponse(PlainTextResponse):
    media_type = "text/markdown"


@router.get("/apps", response_model=list[AppSummary])
async def list_apps(session: SessionDep) -> list[AppSummary]:
    return await service.app_summaries(session)


@router.get("/apps/{key}/graph", response_model=GraphOut)
async def get_graph(key: str, session: SessionDep) -> GraphOut:
    app, nodes, edges, milestones, last_updated = await service.get_graph(session, key)
    return GraphOut(
        app=app,
        nodes=nodes,
        edges=edges,
        milestones=[MilestoneOut.model_validate(m) for m in milestones],
        last_updated=last_updated,
    )


@router.get("/parents", response_model=list[ParentOut])
async def list_parents(session: SessionDep) -> list[ParentOut]:
    return [ParentOut.model_validate(p) for p in await service.list_parents(session)]


@router.get("/overview", response_model=OverviewOut)
async def get_overview(session: SessionDep) -> OverviewOut:
    """Every board on one canvas. The read behind the overview page."""
    return await service.get_overview(session)


@router.get("/config", response_model=ConfigOut)
async def get_config(request: Request, settings: SettingsDep) -> ConfigOut:
    return ConfigOut(
        readonly=settings.readonly,
        authenticated=is_authenticated(request, settings),
    )


@router.get("/agent-instructions", response_class=MarkdownResponse)
async def agent_instructions() -> str:
    """Point an agent here. Plain markdown, not JSON -- it's meant to be read,
    not parsed, and this way `curl`/`fetch` need no unwrapping."""
    return render_instructions()
