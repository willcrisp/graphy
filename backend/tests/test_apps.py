"""Creating, renaming, and deleting whole apps."""

from __future__ import annotations

from sqlalchemy import select

from app.models import App, Edge, Node
from tests.conftest import make_app, make_edge, make_node


async def test_create_derives_a_key_from_the_name(admin, session):
    await make_app(session, "alpha")

    body = (await admin.post("/api/apps", json={"name": "  Tessellate Pro  "})).json()
    assert body["app"]["key"] == "tessellate-pro"
    assert body["app"]["name"] == "Tessellate Pro"
    assert [app["key"] for app in body["apps"]] == ["alpha", "tessellate-pro"]

    graph = await admin.get("/api/apps/tessellate-pro/graph")
    assert graph.status_code == 200
    assert graph.json()["nodes"] == []


async def test_create_uniquifies_a_colliding_key(admin, session):
    await make_app(session, "alpha")

    first = (await admin.post("/api/apps", json={"name": "Alpha"})).json()["app"]
    second = (await admin.post("/api/apps", json={"name": "Alpha"})).json()["app"]

    assert first["key"] == "alpha-2"
    assert second["key"] == "alpha-3"


async def test_create_falls_back_when_the_name_has_no_usable_characters(admin):
    body = (await admin.post("/api/apps", json={"name": "△△△"})).json()
    assert body["app"]["key"] == "app"


async def test_create_rejects_a_blank_name(admin):
    response = await admin.post("/api/apps", json={"name": "   "})
    assert response.status_code == 422
    assert "blank" in response.text


async def test_rename_keeps_the_key_so_links_survive(admin, session):
    app = await make_app(session, "alpha")
    await make_node(session, app, "Ingest")

    body = (await admin.patch("/api/apps/alpha", json={"name": "Alpha Two"})).json()
    assert body["app"]["key"] == "alpha"
    assert body["app"]["name"] == "Alpha Two"
    assert body["apps"][0]["counts"]["todo"] == 1

    graph = await admin.get("/api/apps/alpha/graph")
    assert graph.json()["app"]["name"] == "Alpha Two"


async def test_delete_takes_the_tasks_and_connections_with_it(admin, session):
    doomed = await make_app(session, "alpha")
    await make_app(session, "beta", sort_order=1)
    first = await make_node(session, doomed, "Ingest")
    second = await make_node(session, doomed, "Index")
    await make_edge(session, doomed, first, second)

    body = (await admin.delete("/api/apps/alpha")).json()
    assert [app["key"] for app in body["apps"]] == ["beta"]

    assert (await session.execute(select(App))).scalars().all() != []
    assert (await session.execute(select(Node))).scalars().all() == []
    assert (await session.execute(select(Edge))).scalars().all() == []
    assert (await admin.get("/api/apps/alpha/graph")).status_code == 404


async def test_the_last_app_cannot_be_deleted(admin, session):
    await make_app(session, "alpha", name="Alpha")

    response = await admin.delete("/api/apps/alpha")
    assert response.status_code == 422
    assert "only app" in response.json()["detail"]
    assert (await admin.get("/api/apps/alpha/graph")).status_code == 200


async def test_deleting_an_unknown_app_is_404(admin):
    assert (await admin.delete("/api/apps/nope")).status_code == 404


async def test_app_mutations_need_a_session(client, session):
    await make_app(session, "alpha")
    assert (await client.post("/api/apps", json={"name": "New"})).status_code == 401
    assert (await client.patch("/api/apps/alpha", json={"name": "New"})).status_code == 401
    assert (await client.delete("/api/apps/alpha")).status_code == 401
