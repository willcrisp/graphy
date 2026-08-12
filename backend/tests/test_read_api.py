"""The public read endpoints."""

from __future__ import annotations

from app.services import graph as service
from tests.conftest import make_app, make_node


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_apps_are_ordered_and_counted(client, session):
    second = await make_app(session, "beta", sort_order=1)
    first = await make_app(session, "alpha", sort_order=0)
    await make_node(session, first, "A", "done")
    await make_node(session, first, "B", "done")
    await make_node(session, first, "C", "blocked")
    await make_node(session, second, "D", "wip")

    body = (await client.get("/api/apps")).json()

    assert [app["key"] for app in body] == ["alpha", "beta"]
    assert body[0]["counts"] == {"done": 2, "wip": 0, "todo": 0, "blocked": 1}
    assert body[1]["counts"] == {"done": 0, "wip": 1, "todo": 0, "blocked": 0}


async def test_empty_app_reports_zero_counts(client, session):
    await make_app(session, "empty")
    body = (await client.get("/api/apps")).json()
    assert body[0]["counts"] == {"done": 0, "wip": 0, "todo": 0, "blocked": 0}


async def test_graph_returns_nodes_and_edges(client, session):
    app = await make_app(session, "alpha")
    a = await make_node(session, app, "A", "done")
    b = await make_node(session, app, "B", "wip")
    await service.create_edge(session, app, source_id=a.id, target_id=b.id)

    body = (await client.get("/api/apps/alpha/graph")).json()

    assert body["app"]["key"] == "alpha"
    assert [node["title"] for node in body["nodes"]] == ["A", "B"]
    assert len(body["edges"]) == 1
    assert body["edges"][0]["source_id"] == a.id
    assert body["last_updated"] is not None


async def test_graph_excludes_other_apps(client, session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta")
    await make_node(session, alpha, "Mine")
    await make_node(session, beta, "Theirs")

    body = (await client.get("/api/apps/alpha/graph")).json()
    assert [node["title"] for node in body["nodes"]] == ["Mine"]


async def test_empty_graph_has_no_last_updated(client, session):
    await make_app(session, "empty")
    body = (await client.get("/api/apps/empty/graph")).json()
    assert body["nodes"] == []
    assert body["edges"] == []
    assert body["last_updated"] is None


async def test_unknown_app_is_404(client):
    response = await client.get("/api/apps/nope/graph")
    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


async def test_config_defaults(client):
    assert (await client.get("/api/config")).json() == {
        "readonly": False,
        "authenticated": False,
    }


async def test_agent_instructions_is_public_markdown(client):
    response = await client.get("/api/agent-instructions")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    body = response.text
    # Names every endpoint an importer needs, and stays in sync with the
    # actual status vocabulary rather than a second hardcoded copy of it.
    assert "/api/auth/login" in body
    assert "/api/apps/{key}/nodes" in body
    assert "external_ref" in body
    assert "`done`" in body and "`blocked`" in body
