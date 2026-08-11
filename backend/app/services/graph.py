"""Graph service: reads, mutations, and the invariants from the blueprint.

Every invariant is enforced here rather than in the routers, so the same rules
apply to the seed script and the tests as to HTTP traffic. Failures raise
`GraphError`, which the routers translate to 422 with the message intact — the
messages are written to be shown to a person, not parsed.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import App, Edge, Node
from app.schemas import StatusCounts


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


async def get_node(session: AsyncSession, node_id: int) -> Node:
    node = await session.get(Node, node_id)
    if node is None:
        raise NotFoundError(f"No node with id {node_id}.")
    return node


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


async def delete_node(session: AsyncSession, node_id: int) -> None:
    """Delete a node. Its edges cascade; its children are NOT reparented and
    simply become roots of the layout."""
    node = await get_node(session, node_id)
    await session.delete(node)
    await session.commit()


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
        raise GraphError("A feature cannot depend on itself.")

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
                f"{label} feature belongs to a different app. "
                "Connections cannot cross between apps."
            )

    existing = await session.scalar(
        select(Edge).where(Edge.source_id == source_id, Edge.target_id == target_id)
    )
    if existing is not None:
        raise GraphError("Those two features are already connected.")

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


async def delete_edge(session: AsyncSession, edge_id: int) -> None:
    edge = await session.get(Edge, edge_id)
    if edge is None:
        raise NotFoundError(f"No connection with id {edge_id}.")
    await session.execute(delete(Edge).where(Edge.id == edge_id))
    await session.commit()
