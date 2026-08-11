"""Mutating endpoints.

Both guards are router-level dependencies, so a new endpoint added here inherits
them rather than having to remember them. `require_writable` runs first: the
global read-only switch beats a valid session.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.auth import require_admin, require_writable
from app.deps import SessionDep
from app.schemas import EdgeCreate, EdgeOut, NodeCreate, NodeOut, NodeUpdate
from app.services import graph as service

router = APIRouter(
    prefix="/api",
    tags=["admin"],
    dependencies=[Depends(require_writable), Depends(require_admin)],
)


@router.post(
    "/apps/{key}/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED
)
async def create_node(key: str, body: NodeCreate, session: SessionDep) -> NodeOut:
    app = await service.get_app(session, key)
    node = await service.create_node(
        session, app, title=body.title, detail=body.detail, status=body.status
    )
    return NodeOut.model_validate(node)


@router.patch("/nodes/{node_id}", response_model=NodeOut)
async def update_node(node_id: int, body: NodeUpdate, session: SessionDep) -> NodeOut:
    changes = body.model_dump(exclude_unset=True)
    node = await service.update_node(session, node_id, changes)
    return NodeOut.model_validate(node)


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: int, session: SessionDep) -> Response:
    await service.delete_node(session, node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/apps/{key}/edges", response_model=EdgeOut, status_code=status.HTTP_201_CREATED
)
async def create_edge(key: str, body: EdgeCreate, session: SessionDep) -> EdgeOut:
    app = await service.get_app(session, key)
    edge = await service.create_edge(
        session, app, source_id=body.source_id, target_id=body.target_id
    )
    return EdgeOut.model_validate(edge)


@router.delete("/edges/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(edge_id: int, session: SessionDep) -> Response:
    await service.delete_edge(session, edge_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
