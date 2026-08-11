"""Graph service: reads, mutations, and the invariants from the blueprint.

Every invariant is enforced here rather than in the routers, so the same rules
apply to the seed script and the tests as to HTTP traffic. Failures raise
`GraphError`, which the routers translate to 422 with the message intact — the
messages are written to be shown to a person, not parsed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import App, Edge, Node
from app.schemas import AppSummary, BoardOut, GraphOut, StatusCounts


class GraphError(Exception):
    """A request that is well-formed but violates a graph invariant (422)."""


class NotFoundError(Exception):
    """A referenced app, node, or edge does not exist (404)."""


# --- reads -----------------------------------------------------------------


async def list_apps(session: AsyncSession) -> list[tuple[App, StatusCounts]]:
    apps = (
        (await session.execute(select(App).order_by(App.sort_order, App.id)))
        .scalars()
        .all()
    )
    rows = await session.execute(
        select(Node.app_id, Node.status, func.count()).group_by(
            Node.app_id, Node.status
        )
    )
    tally: dict[int, dict[str, int]] = defaultdict(dict)
    for app_id, status, count in rows:
        tally[app_id][status] = count
    return [(app, StatusCounts(**tally.get(app.id, {}))) for app in apps]


async def get_app(session: AsyncSession, key: str) -> App:
    app = (
        await session.execute(select(App).where(App.key == key))
    ).scalar_one_or_none()
    if app is None:
        raise NotFoundError(f"No app with key {key!r}.")
    return app


async def get_app_by_id(session: AsyncSession, app_id: int) -> App:
    app = await session.get(App, app_id)
    if app is None:
        raise NotFoundError(f"No app with id {app_id}.")
    return app


async def get_graph(
    session: AsyncSession, key: str
) -> tuple[App, list[Node], list[Edge], datetime | None]:
    app = await get_app(session, key)
    nodes = (
        (
            await session.execute(
                select(Node)
                .where(Node.app_id == app.id)
                .order_by(Node.sort_order, Node.id)
            )
        )
        .scalars()
        .all()
    )
    edges = (
        (await session.execute(select(Edge).where(Edge.app_id == app.id).order_by(Edge.id)))
        .scalars()
        .all()
    )
    last_updated = max((node.updated_at for node in nodes), default=None)
    return app, list(nodes), list(edges), last_updated


async def app_summaries(session: AsyncSession) -> list[AppSummary]:
    return [
        AppSummary(
            id=app.id,
            key=app.key,
            name=app.name,
            accent=app.accent,
            sort_order=app.sort_order,
            counts=counts,
        )
        for app, counts in await list_apps(session)
    ]


async def get_board(session: AsyncSession, key: str) -> BoardOut:
    """The whole redraw payload: one app's graph plus every app's counts."""
    app, nodes, edges, last_updated = await get_graph(session, key)
    return BoardOut(
        graph=GraphOut(app=app, nodes=nodes, edges=edges, last_updated=last_updated),
        apps=await app_summaries(session),
    )


async def get_node(session: AsyncSession, node_id: int) -> Node:
    node = await session.get(Node, node_id)
    if node is None:
        raise NotFoundError(f"No node with id {node_id}.")
    return node


# --- app mutations ---------------------------------------------------------

#: The seeded accents, reused in order for apps created through the UI. Each is
#: chosen against the light ground; `--accent-draw` lightens it for dark.
ACCENTS = ("#1F5F8B", "#5B4B8A", "#2F6B5E", "#8A4B2F", "#7A5C1E", "#6B2F5B")


def _slug(name: str) -> str:
    """A URL key from a display name. Keys never change after creation, so a
    later rename leaves existing links working."""
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return cleaned[:64] or "app"


async def _free_key(session: AsyncSession, name: str) -> str:
    base = _slug(name)
    taken = set(
        (await session.execute(select(App.key).where(App.key.like(f"{base}%"))))
        .scalars()
        .all()
    )
    if base not in taken:
        return base
    suffix = 2
    while f"{base}-{suffix}" in taken:
        suffix += 1
    return f"{base}-{suffix}"


async def create_app(
    session: AsyncSession, *, name: str, accent: str | None = None
) -> App:
    highest = await session.scalar(select(func.max(App.sort_order)))
    count = await session.scalar(select(func.count()).select_from(App)) or 0
    app = App(
        key=await _free_key(session, name),
        name=name,
        accent=accent or ACCENTS[count % len(ACCENTS)],
        sort_order=(highest or 0) + 1,
    )
    session.add(app)
    await session.commit()
    await session.refresh(app)
    return app


async def rename_app(session: AsyncSession, key: str, name: str) -> App:
    app = await get_app(session, key)
    app.name = name
    await session.commit()
    await session.refresh(app)
    return app


async def delete_app(session: AsyncSession, key: str) -> None:
    """Delete an app and, by cascade, every task and connection on it.

    The last app cannot be deleted: the board has no meaningful empty state, and
    an accidental delete here is unrecoverable rather than merely annoying."""
    app = await get_app(session, key)
    remaining = await session.scalar(select(func.count()).select_from(App))
    if (remaining or 0) <= 1:
        raise GraphError(
            f"{app.name!r} is the only app. Create another one before deleting it."
        )
    await session.delete(app)
    await session.commit()


# --- node mutations --------------------------------------------------------


async def create_node(
    session: AsyncSession, app: App, *, title: str, detail: str | None, status: str
) -> Node:
    highest = await session.scalar(
        select(func.max(Node.sort_order)).where(Node.app_id == app.id)
    )
    node = Node(
        app_id=app.id,
        title=title,
        detail=detail,
        status=status,
        sort_order=(highest or 0) + 1,
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return node


async def update_node(
    session: AsyncSession, node_id: int, changes: dict[str, object]
) -> Node:
    node = await get_node(session, node_id)
    for field, value in changes.items():
        setattr(node, field, value)
    await session.commit()
    await session.refresh(node)
    return node


async def delete_node(session: AsyncSession, node_id: int) -> App:
    """Delete a node. Its edges cascade; its children are NOT reparented and
    simply become roots of the layout.

    Returns the app it belonged to, which the caller needs to rebuild the board
    once the node itself is gone."""
    node = await get_node(session, node_id)
    app = await get_app_by_id(session, node.app_id)
    await session.delete(node)
    await session.commit()
    return app


# --- edge mutations --------------------------------------------------------


async def _adjacency(session: AsyncSession, app_id: int) -> dict[int, list[int]]:
    rows = await session.execute(
        select(Edge.source_id, Edge.target_id).where(Edge.app_id == app_id)
    )
    graph: dict[int, list[int]] = defaultdict(list)
    for source, target in rows:
        graph[source].append(target)
    return graph


def _reaches(graph: dict[int, list[int]], start: int, goal: int) -> bool:
    """Depth-first search for `goal` from `start` over the existing edges."""
    seen: set[int] = set()
    stack = [start]
    while stack:
        current = stack.pop()
        if current == goal:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(graph.get(current, ()))
    return False


async def create_edge(
    session: AsyncSession, app: App, *, source_id: int, target_id: int
) -> Edge:
    if source_id == target_id:
        raise GraphError("A task cannot depend on itself.")

    source = await session.get(Node, source_id)
    target = await session.get(Node, target_id)
    for label, node, node_id in (
        ("Source", source, source_id),
        ("Target", target, target_id),
    ):
        if node is None:
            raise NotFoundError(f"{label} node {node_id} does not exist.")
        if node.app_id != app.id:
            raise GraphError(
                f"{label} task belongs to a different app. "
                "Connections cannot cross between apps."
            )

    existing = await session.scalar(
        select(Edge).where(Edge.source_id == source_id, Edge.target_id == target_id)
    )
    if existing is not None:
        raise GraphError("Those two tasks are already connected.")

    # A new edge source -> target closes a loop exactly when target already
    # reaches source.
    if _reaches(await _adjacency(session, app.id), target_id, source_id):
        raise GraphError(
            "That connection would create a loop: "
            f"{target.title!r} already leads back to {source.title!r}."
        )

    edge = Edge(app_id=app.id, source_id=source_id, target_id=target_id)
    session.add(edge)
    await session.commit()
    await session.refresh(edge)
    return edge


async def delete_edge(session: AsyncSession, edge_id: int) -> App:
    edge = await session.get(Edge, edge_id)
    if edge is None:
        raise NotFoundError(f"No connection with id {edge_id}.")
    app = await get_app_by_id(session, edge.app_id)
    await session.execute(delete(Edge).where(Edge.id == edge_id))
    await session.commit()
    return app
