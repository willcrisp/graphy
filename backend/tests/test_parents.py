"""Parent projects and the overview that draws them.

A parent project is the one thing above an app: several boards point at the
same row, and the overview canvas uses that to join them. The rules worth
holding onto are that a parent is optional, that its name is unique, and above
all that deleting one detaches its boards rather than taking them with it.
"""

from __future__ import annotations

from sqlalchemy import select

from app.models import App, Parent
from tests.conftest import make_app, make_edge, make_node, make_parent


async def test_create_returns_the_whole_overview(admin, session):
    await make_app(session, "alpha")

    response = await admin.post(
        "/api/parents", json={"name": "  Platform  ", "detail": "  Shared bits.  "}
    )
    assert response.status_code == 201
    body = response.json()

    assert body["parent"]["name"] == "Platform"
    assert body["parent"]["detail"] == "Shared bits."
    # A parent mutation answers with the overview, not one board: it changes
    # the structure between boards rather than the contents of any one of them.
    assert [p["name"] for p in body["parents"]] == ["Platform"]
    assert [app["key"] for app in body["apps"]] == ["alpha"]
    assert body["apps"][0]["parent_id"] is None


async def test_create_rejects_a_name_already_taken(admin, session):
    await make_parent(session, "Platform")

    response = await admin.post("/api/parents", json={"name": "  platform "})
    assert response.status_code == 422
    assert "already a parent project" in response.json()["detail"]
    assert len((await session.execute(select(Parent))).scalars().all()) == 1


async def test_create_rejects_a_blank_name(admin):
    response = await admin.post("/api/parents", json={"name": "   "})
    assert response.status_code == 422
    assert "blank" in response.text


async def test_update_touches_only_the_fields_sent(admin, session):
    parent = await make_parent(session, "Platform", "The original description.")

    renamed = await admin.patch(f"/api/parents/{parent.id}", json={"name": "Core"})
    assert renamed.json()["parent"] == {
        **renamed.json()["parent"],
        "name": "Core",
        "detail": "The original description.",
    }

    # An explicit null clears the description; an absent key would not.
    cleared = await admin.patch(f"/api/parents/{parent.id}", json={"detail": None})
    assert cleared.json()["parent"]["detail"] is None
    assert cleared.json()["parent"]["name"] == "Core"


async def test_update_may_keep_its_own_name(admin, session):
    parent = await make_parent(session, "Platform")

    response = await admin.patch(
        f"/api/parents/{parent.id}", json={"name": "Platform", "detail": "New words."}
    )
    assert response.status_code == 200
    assert response.json()["parent"]["detail"] == "New words."


async def test_update_still_rejects_another_parents_name(admin, session):
    await make_parent(session, "Platform")
    other = await make_parent(session, "Tooling", sort_order=1)

    response = await admin.patch(f"/api/parents/{other.id}", json={"name": "Platform"})
    assert response.status_code == 422


async def test_attaching_and_detaching_a_board(admin, session):
    parent = await make_parent(session, "Platform")
    await make_app(session, "alpha")

    attached = await admin.put("/api/apps/alpha/parent", json={"parent_id": parent.id})
    assert attached.status_code == 200
    assert attached.json()["apps"][0]["parent_id"] == parent.id

    detached = await admin.put("/api/apps/alpha/parent", json={"parent_id": None})
    assert detached.json()["apps"][0]["parent_id"] is None


async def test_attaching_to_an_unknown_parent_is_404(admin, session):
    await make_app(session, "alpha")

    response = await admin.put("/api/apps/alpha/parent", json={"parent_id": 9999})
    assert response.status_code == 404
    # The board is left alone rather than pointed at a parent that isn't there.
    app = await session.scalar(select(App).where(App.key == "alpha"))
    assert app.parent_id is None


async def test_deleting_a_parent_detaches_its_boards_but_keeps_them(admin, session):
    parent = await make_parent(session, "Platform")
    app = await make_app(session, "alpha", parent_id=parent.id)
    await make_app(session, "beta", sort_order=1, parent_id=parent.id)
    await make_node(session, app, "Ingest")

    body = (await admin.delete(f"/api/parents/{parent.id}")).json()

    assert body["parents"] == []
    # Both boards survive, standalone, with their tasks intact. Deleting the
    # grouping above a board must never be a way to lose the board.
    assert [(a["key"], a["parent_id"]) for a in body["apps"]] == [
        ("alpha", None),
        ("beta", None),
    ]
    assert (await admin.get("/api/apps/alpha/graph")).status_code == 200
    assert [node["title"] for node in body["nodes"] if not node["is_root"]] == ["Ingest"]


async def test_deleting_an_unknown_parent_is_404(admin):
    assert (await admin.delete("/api/parents/9999")).status_code == 404


async def test_overview_carries_every_board_at_once(client, session):
    parent = await make_parent(session, "Platform", "Shared bits.")
    alpha = await make_app(session, "alpha", parent_id=parent.id)
    beta = await make_app(session, "beta", sort_order=1)
    first = await make_node(session, alpha, "Ingest", status="done")
    second = await make_node(session, alpha, "Index")
    await make_edge(session, alpha, first, second)
    await make_node(session, beta, "Probe", status="wip")

    body = (await client.get("/api/overview")).json()

    assert [p["name"] for p in body["parents"]] == ["Platform"]
    assert [(a["key"], a["parent_id"]) for a in body["apps"]] == [
        ("alpha", parent.id),
        ("beta", None),
    ]
    # Nodes and edges from every board arrive in one flat list, told apart by
    # app_id -- there is no per-app envelope to unwrap.
    assert sorted(node["title"] for node in body["nodes"]) == [
        "Index",
        "Ingest",
        "Probe",
    ]
    assert {node["app_id"] for node in body["nodes"]} == {alpha.id, beta.id}
    assert len(body["edges"]) == 1
    assert body["last_updated"] is not None


async def test_overview_is_ordered_by_board_then_sort_order(client, session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta", sort_order=1)
    # Interleave the writes, so a bare id ordering would mix the two boards.
    await make_node(session, alpha, "A1")
    await make_node(session, beta, "B1")
    await make_node(session, alpha, "A2")

    nodes = (await client.get("/api/overview")).json()["nodes"]
    assert [node["title"] for node in nodes] == ["A1", "A2", "B1"]


async def test_overview_is_readable_without_a_session(client, session):
    await make_parent(session, "Platform")
    await make_app(session, "alpha")

    assert (await client.get("/api/overview")).status_code == 200
    assert (await client.get("/api/parents")).status_code == 200


async def test_parent_mutations_need_a_session(client, session):
    parent = await make_parent(session, "Platform")
    await make_app(session, "alpha")

    assert (await client.post("/api/parents", json={"name": "New"})).status_code == 401
    assert (
        await client.patch(f"/api/parents/{parent.id}", json={"name": "New"})
    ).status_code == 401
    assert (await client.delete(f"/api/parents/{parent.id}")).status_code == 401
    assert (
        await client.put("/api/apps/alpha/parent", json={"parent_id": parent.id})
    ).status_code == 401
