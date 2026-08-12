"""Mutating endpoints.

Both guards are router-level dependencies, so a new endpoint added here inherits
them rather than having to remember them. `require_writable` runs first: the
global read-only switch beats a valid session.

Every endpoint returns the whole board (see `BoardOut`), including the deletes,
which is why none of them are 204. The client patches its state optimistically
and uses this response to reconcile, so a mutation costs one round trip rather
than a mutation followed by a re-fetch.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.auth import require_admin, require_writable
from app.deps import SessionDep
from app.models import App, Edge, Node
from app.schemas import (
    AppCreate,
    AppMutationOut,
    AppOut,
    AppsOut,
    AppUpdate,
    BoardOut,
    EdgeCreate,
    EdgeMutationOut,
    EdgeOut,
    NodeCreate,
    NodeMutationOut,
    NodeOut,
    NodeUpdate,
)
from app.services import graph as service

router = APIRouter(
    prefix="/api",
    tags=["admin"],
    dependencies=[Depends(require_writable), Depends(require_admin)],
)


# Every handler below writes one row and then hands back a full response
# built from the *current* state of the board (see BoardOut's docstring for
# why: it's what lets the client reconcile in one round trip instead of a
# write followed by a re-fetch). These three helpers are that second half --
# "wrap this row with a freshly-read board" -- factored out so a handler is
# just "call the service, then wrap the result."


async def _app_mutation(session: SessionDep, app: App) -> AppMutationOut:
    return AppMutationOut(
        app=AppOut.model_validate(app), apps=await service.app_summaries(session)
    )


async def _node_mutation(session: SessionDep, app_key: str, node: Node) -> NodeMutationOut:
    board = await service.get_board(session, app_key)
    return NodeMutationOut(
        node=NodeOut.model_validate(node), graph=board.graph, apps=board.apps
    )


async def _edge_mutation(session: SessionDep, app_key: str, edge: Edge) -> EdgeMutationOut:
    board = await service.get_board(session, app_key)
    return EdgeMutationOut(
        edge=EdgeOut.model_validate(edge), graph=board.graph, apps=board.apps
    )


@router.post("/apps", response_model=AppMutationOut, status_code=status.HTTP_201_CREATED)
async def create_app(body: AppCreate, session: SessionDep) -> AppMutationOut:
    app = await service.create_app(session, name=body.name, accent=body.accent)
    return await _app_mutation(session, app)


@router.patch("/apps/{key}", response_model=AppMutationOut)
async def rename_app(key: str, body: AppUpdate, session: SessionDep) -> AppMutationOut:
    app = await service.rename_app(session, key, body.name)
    return await _app_mutation(session, app)


@router.delete("/apps/{key}", response_model=AppsOut)
async def delete_app(key: str, session: SessionDep) -> AppsOut:
    await service.delete_app(session, key)
    return AppsOut(apps=await service.app_summaries(session))


@router.post(
    "/apps/{key}/nodes",
    response_model=NodeMutationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_node(key: str, body: NodeCreate, session: SessionDep) -> NodeMutationOut:
    app = await service.get_app(session, key)
    node = await service.create_node(
        session,
        app,
        title=body.title,
        detail=body.detail,
        status=body.status,
        external_ref=body.external_ref,
    )
    return await _node_mutation(session, app.key, node)


@router.patch("/nodes/{node_id}", response_model=NodeMutationOut)
async def update_node(
    node_id: int, body: NodeUpdate, session: SessionDep
) -> NodeMutationOut:
    changes = body.model_dump(exclude_unset=True)
    node = await service.update_node(session, node_id, changes)
    app = await service.get_app_by_id(session, node.app_id)
    return await _node_mutation(session, app.key, node)


@router.delete("/nodes/{node_id}", response_model=BoardOut)
async def delete_node(node_id: int, session: SessionDep) -> BoardOut:
    app = await service.delete_node(session, node_id)
    return await service.get_board(session, app.key)


@router.post(
    "/apps/{key}/edges",
    response_model=EdgeMutationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_edge(key: str, body: EdgeCreate, session: SessionDep) -> EdgeMutationOut:
    app = await service.get_app(session, key)
    edge = await service.create_edge(
        session, app, source_id=body.source_id, target_id=body.target_id
    )
    return await _edge_mutation(session, app.key, edge)


@router.delete("/edges/{edge_id}", response_model=BoardOut)
async def delete_edge(edge_id: int, session: SessionDep) -> BoardOut:
    app = await service.delete_edge(session, edge_id)
    return await service.get_board(session, app.key)
