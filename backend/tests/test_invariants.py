"""One test (at least) per invariant in section 3 of the blueprint."""

from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app.models import Edge, Node
from app.services import graph as service
from app.services.graph import GraphError, NotFoundError
from tests.conftest import make_app, make_edge, make_node


# --- Invariant 1: no cross-app edges ---------------------------------------


async def test_edge_across_apps_is_rejected(session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta")
    here = await make_node(session, alpha, "Here")
    there = await make_node(session, beta, "There")

    with pytest.raises(GraphError, match="different app"):
        await service.create_edge(session, alpha, source_id=here.id, target_id=there.id)

    assert (await session.execute(select(Edge))).scalars().all() == []


async def test_edge_with_foreign_source_is_rejected(session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta")
    foreign = await make_node(session, beta, "Foreign")
    mine = await make_node(session, alpha, "Mine")

    with pytest.raises(GraphError, match="different app"):
        await service.create_edge(
            session, alpha, source_id=foreign.id, target_id=mine.id
        )


# --- Invariant 2: no self-edges --------------------------------------------


async def test_self_edge_is_rejected(session):
    app = await make_app(session)
    node = await make_node(session, app, "Only")

    with pytest.raises(GraphError, match="cannot depend on itself"):
        await service.create_edge(session, app, source_id=node.id, target_id=node.id)


# --- Invariant 3: no cycles ------------------------------------------------


async def test_direct_cycle_is_rejected(session):
    app = await make_app(session)
    a = await make_node(session, app, "A")
    b = await make_node(session, app, "B")
    await service.create_edge(session, app, source_id=a.id, target_id=b.id)

    with pytest.raises(GraphError, match="loop"):
        await service.create_edge(session, app, source_id=b.id, target_id=a.id)


async def test_transitive_cycle_is_rejected(session):
    app = await make_app(session)
    a, b, c, d = [await make_node(session, app, name) for name in "ABCD"]
    for source, target in ((a, b), (b, c), (c, d)):
        await service.create_edge(session, app, source_id=source.id, target_id=target.id)

    with pytest.raises(GraphError, match="loop"):
        await service.create_edge(session, app, source_id=d.id, target_id=a.id)


async def test_diamond_is_allowed(session):
    """A converging diamond is not a cycle and must be permitted."""
    app = await make_app(session)
    top, left, right, bottom = [
        await make_node(session, app, name) for name in ("top", "left", "right", "bottom")
    ]
    for source, target in ((top, left), (top, right), (left, bottom), (right, bottom)):
        await service.create_edge(session, app, source_id=source.id, target_id=target.id)

    assert len((await session.execute(select(Edge))).scalars().all()) == 4


async def test_duplicate_edge_is_rejected(session):
    app = await make_app(session)
    a = await make_node(session, app, "A")
    b = await make_node(session, app, "B")
    await service.create_edge(session, app, source_id=a.id, target_id=b.id)

    with pytest.raises(GraphError, match="already connected"):
        await service.create_edge(session, app, source_id=a.id, target_id=b.id)


async def test_edge_to_missing_node_is_not_found(session):
    app = await make_app(session)
    a = await make_node(session, app, "A")

    with pytest.raises(NotFoundError):
        await service.create_edge(session, app, source_id=a.id, target_id=9999)


# --- Invariant: external_ref is unique per app, for idempotent imports -----


async def test_duplicate_external_ref_in_same_app_is_rejected(session):
    app = await make_app(session)
    await service.create_node(
        session, app, title="A", detail=None, status="todo", external_ref="JIRA-1"
    )
    with pytest.raises(GraphError, match="JIRA-1"):
        await service.create_node(
            session, app, title="B", detail=None, status="todo", external_ref="JIRA-1"
        )


async def test_same_external_ref_allowed_in_different_apps(session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta")
    await service.create_node(
        session, alpha, title="A", detail=None, status="todo", external_ref="JIRA-1"
    )
    # Does not raise.
    await service.create_node(
        session, beta, title="B", detail=None, status="todo", external_ref="JIRA-1"
    )


async def test_patching_external_ref_onto_a_duplicate_is_rejected(session):
    app = await make_app(session)
    await service.create_node(
        session, app, title="A", detail=None, status="todo", external_ref="JIRA-1"
    )
    other = await make_node(session, app, "B")
    with pytest.raises(GraphError, match="JIRA-1"):
        await service.update_node(session, other.id, {"external_ref": "JIRA-1"})


async def test_node_keeps_its_own_external_ref_on_unrelated_patch(session):
    app = await make_app(session)
    node = await service.create_node(
        session, app, title="A", detail=None, status="todo", external_ref="JIRA-1"
    )
    updated = await service.update_node(session, node.id, {"status": "wip"})
    assert updated.external_ref == "JIRA-1"


# --- Invariant 4: status validated at the API boundary ---------------------


async def test_invalid_status_rejected_by_api(admin, session):
    await make_app(session, "alpha")
    response = await admin.post(
        "/api/apps/alpha/nodes", json={"title": "Bad", "status": "in-progress"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("status", ["done", "wip", "todo", "blocked"])
async def test_every_valid_status_accepted(admin, session, status):
    await make_app(session, "alpha")
    response = await admin.post(
        "/api/apps/alpha/nodes", json={"title": f"Node {status}", "status": status}
    )
    assert response.status_code == 201, response.text
    assert response.json()["node"]["status"] == status


async def test_blank_title_rejected(admin, session):
    await make_app(session, "alpha")
    response = await admin.post(
        "/api/apps/alpha/nodes", json={"title": "   ", "status": "todo"}
    )
    assert response.status_code == 422


async def test_invalid_status_rejected_on_patch(admin, session):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    response = await admin.patch(f"/api/nodes/{node.id}", json={"status": "nearly"})
    assert response.status_code == 422


# --- Invariant 5: delete cascades edges, does not reparent -----------------


async def test_deleting_node_cascades_edges_and_orphans_children(session):
    app = await make_app(session)
    root = await make_node(session, app, "root")
    middle = await make_node(session, app, "middle")
    leaf = await make_node(session, app, "leaf")
    await service.create_edge(session, app, source_id=root.id, target_id=middle.id)
    await service.create_edge(session, app, source_id=middle.id, target_id=leaf.id)

    await service.delete_node(session, middle.id)

    remaining_nodes = {n.title for n in (await session.execute(select(Node))).scalars()}
    remaining_edges = (await session.execute(select(Edge))).scalars().all()

    assert remaining_nodes == {"root", "leaf"}
    # Both edges touched the deleted node, so both are gone. The leaf is now a
    # root of the layout; it is NOT reattached to `root`.
    assert remaining_edges == []


async def test_deleting_app_cascades_nodes_and_edges(session):
    app = await make_app(session)
    a = await make_node(session, app, "A")
    b = await make_node(session, app, "B")
    await make_edge(session, app, a, b)

    await session.delete(app)
    await session.commit()

    assert (await session.execute(select(Node))).scalars().all() == []
    assert (await session.execute(select(Edge))).scalars().all() == []


# --- Invariant 6: PRAGMA foreign_keys is ON on every connection ------------


async def test_foreign_keys_pragma_is_enabled(session):
    assert (await session.execute(text("PRAGMA foreign_keys"))).scalar() == 1


async def test_pragma_holds_on_a_second_connection(database):
    async with database.session() as first, database.session() as second:
        assert (await first.execute(text("PRAGMA foreign_keys"))).scalar() == 1
        assert (await second.execute(text("PRAGMA foreign_keys"))).scalar() == 1


async def test_orphan_node_insert_is_refused_by_foreign_key(session):
    """Direct proof the pragma is doing work: this insert would succeed if
    foreign keys were off."""
    from sqlalchemy.exc import IntegrityError

    session.add(Node(app_id=4242, title="Orphan", status="todo"))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


# --- Invariant 6: the root node is structural, not an ordinary task --------


async def test_create_app_gives_it_a_root_node(session):
    app = await service.create_app(session, name="Widgets")
    root = await session.scalar(select(Node).where(Node.app_id == app.id, Node.is_root.is_(True)))
    assert root is not None
    assert root.title == "Widgets"


async def test_root_node_cannot_be_deleted(session):
    app = await service.create_app(session, name="Widgets")
    root = await session.scalar(select(Node).where(Node.app_id == app.id, Node.is_root.is_(True)))
    with pytest.raises(GraphError):
        await service.delete_node(session, root.id)


async def test_root_node_cannot_be_edited_directly(session):
    app = await service.create_app(session, name="Widgets")
    root = await session.scalar(select(Node).where(Node.app_id == app.id, Node.is_root.is_(True)))
    with pytest.raises(GraphError):
        await service.update_node(session, root.id, {"title": "Renamed"})


async def test_root_node_cannot_be_connected_to_other_tasks(session):
    app = await service.create_app(session, name="Widgets")
    root = await session.scalar(select(Node).where(Node.app_id == app.id, Node.is_root.is_(True)))
    task = await make_node(session, app, "A task")
    with pytest.raises(GraphError):
        await service.create_edge(session, app, source_id=root.id, target_id=task.id)


async def test_renaming_app_renames_its_root_node(session):
    app = await service.create_app(session, name="Widgets")
    await service.rename_app(session, app.key, "Gadgets")
    root = await session.scalar(select(Node).where(Node.app_id == app.id, Node.is_root.is_(True)))
    assert root.title == "Gadgets"


async def test_root_node_excluded_from_status_tally(session):
    app = await service.create_app(session, name="Widgets")
    await make_node(session, app, "A task", status="done")
    counts = (await service.app_summaries(session))[0].counts
    assert counts.done == 1
    assert sum([counts.done, counts.wip, counts.todo, counts.blocked]) == 1
