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

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import App, Edge, Node, Parent
from app.schemas import (
    AppSummary,
    BoardOut,
    GraphOut,
    OverviewOut,
    ParentOut,
    StatusCounts,
)


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
        # The root node carries a filler status (see create_app) and is not a
        # real task, so it must never inflate the tally the tab strip shows.
        select(Node.app_id, Node.status, func.count())
        .where(Node.is_root.is_(False))
        .group_by(Node.app_id, Node.status)
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
            parent_id=app.parent_id,
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


async def list_parents(session: AsyncSession) -> list[Parent]:
    return list(
        (
            await session.execute(select(Parent).order_by(Parent.sort_order, Parent.id))
        )
        .scalars()
        .all()
    )


async def get_parent(session: AsyncSession, parent_id: int) -> Parent:
    parent = await session.get(Parent, parent_id)
    if parent is None:
        raise NotFoundError(f"No parent project with id {parent_id}.")
    return parent


async def get_overview(session: AsyncSession) -> OverviewOut:
    """Every board's nodes and edges in one payload, plus the parent projects.

    Ordered the same way `get_graph` orders one board -- by app, then
    `sort_order`, then id -- because the overview canvas feeds this straight to
    dagre, whose output depends on insertion order. Layout stability across
    reloads is a tested requirement here exactly as it is for a single board.
    """
    nodes = (
        (
            await session.execute(
                select(Node).order_by(Node.app_id, Node.sort_order, Node.id)
            )
        )
        .scalars()
        .all()
    )
    edges = (
        (await session.execute(select(Edge).order_by(Edge.app_id, Edge.id)))
        .scalars()
        .all()
    )
    return OverviewOut(
        parents=[ParentOut.model_validate(p) for p in await list_parents(session)],
        apps=await app_summaries(session),
        nodes=list(nodes),
        edges=list(edges),
        last_updated=max((node.updated_at for node in nodes), default=None),
    )


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
    await session.flush()
    # Every app gets a root node representing the app itself -- the single
    # top-level ancestor the graph hangs off. `status` is filler (never shown,
    # excluded from tallies above); sort_order is negative so it always sorts
    # before ordinary nodes, which start at 1 (see create_node).
    session.add(
        Node(app_id=app.id, title=app.name, status="todo", is_root=True, sort_order=-1)
    )
    await session.commit()
    await session.refresh(app)
    return app


async def rename_app(session: AsyncSession, key: str, name: str) -> App:
    app = await get_app(session, key)
    app.name = name
    root = await session.scalar(
        select(Node).where(Node.app_id == app.id, Node.is_root.is_(True))
    )
    if root is not None:
        root.title = name
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


# --- parent project mutations ----------------------------------------------


async def _check_parent_name_free(
    session: AsyncSession, name: str, *, exclude_id: int | None = None
) -> None:
    """Parent projects are picked from a list by name, so two that differ only
    in case are indistinguishable to the person choosing one. Checked here so
    the refusal is a sentence; `uq` on the column is the backstop under it."""
    query = select(Parent).where(func.lower(Parent.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Parent.id != exclude_id)
    existing = await session.scalar(query)
    if existing is not None:
        raise GraphError(f"There is already a parent project called {existing.name!r}.")


async def create_parent(
    session: AsyncSession, *, name: str, detail: str | None = None
) -> Parent:
    await _check_parent_name_free(session, name)
    highest = await session.scalar(select(func.max(Parent.sort_order)))
    parent = Parent(name=name, detail=detail, sort_order=(highest or 0) + 1)
    session.add(parent)
    await session.commit()
    await session.refresh(parent)
    return parent


async def update_parent(
    session: AsyncSession, parent_id: int, changes: dict[str, object]
) -> Parent:
    parent = await get_parent(session, parent_id)
    name = changes.get("name")
    if isinstance(name, str):
        await _check_parent_name_free(session, name, exclude_id=parent.id)
    for field, value in changes.items():
        setattr(parent, field, value)
    await session.commit()
    await session.refresh(parent)
    return parent


async def delete_parent(session: AsyncSession, parent_id: int) -> None:
    """Delete a parent project. Its boards survive and become standalone.

    The detach is written out rather than left to the FK's `ON DELETE SET NULL`
    because the two disagree about *when*: the pragma fires in the database at
    delete time, leaving any App already loaded in this session holding a stale
    `parent_id`. Doing it here means the summaries built straight afterwards
    are right without a session expiry.
    """
    parent = await get_parent(session, parent_id)
    await session.execute(
        update(App).where(App.parent_id == parent.id).values(parent_id=None)
    )
    await session.delete(parent)
    await session.commit()


async def set_app_parent(
    session: AsyncSession, key: str, parent_id: int | None
) -> App:
    """Attach a board to a parent project, or detach it with `None`."""
    app = await get_app(session, key)
    # Resolved rather than trusted: an unknown id is a 404, not a dangling FK
    # that only surfaces when the overview tries to draw the join.
    if parent_id is not None:
        await get_parent(session, parent_id)
    app.parent_id = parent_id
    await session.commit()
    await session.refresh(app)
    return app


# --- node mutations --------------------------------------------------------


async def _check_external_ref_free(
    session: AsyncSession, app_id: int, external_ref: str, *, exclude_node_id: int | None = None
) -> None:
    """`external_ref` is how an importer (e.g. an agent syncing Jira tickets)
    recognises a node it already created, so it must be unique per app -- the
    same collision the DB's unique constraint enforces, checked here first so
    the failure reads as a sentence instead of an IntegrityError."""
    query = select(Node).where(
        Node.app_id == app_id, Node.external_ref == external_ref
    )
    if exclude_node_id is not None:
        query = query.where(Node.id != exclude_node_id)
    existing = await session.scalar(query)
    if existing is not None:
        raise GraphError(
            f"external_ref {external_ref!r} is already used by task "
            f"{existing.title!r} in this app."
        )


async def create_node(
    session: AsyncSession,
    app: App,
    *,
    title: str,
    detail: str | None,
    status: str,
    external_ref: str | None = None,
) -> Node:
    if external_ref is not None:
        await _check_external_ref_free(session, app.id, external_ref)
    highest = await session.scalar(
        select(func.max(Node.sort_order)).where(Node.app_id == app.id)
    )
    node = Node(
        app_id=app.id,
        title=title,
        detail=detail,
        status=status,
        external_ref=external_ref,
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
    if node.is_root:
        raise GraphError("The root node is renamed by renaming the app, not edited directly.")
    external_ref = changes.get("external_ref")
    if external_ref is not None:
        await _check_external_ref_free(
            session, node.app_id, external_ref, exclude_node_id=node.id
        )
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
    if node.is_root:
        raise GraphError("The root node cannot be deleted. Delete the app instead.")
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
        if node.is_root:
            raise GraphError(
                "The root node connects to every top-level task automatically "
                "and cannot be wired by hand."
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
