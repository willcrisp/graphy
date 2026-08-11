"""The editing endpoints end to end, including the messages the UI shows."""

from __future__ import annotations

from tests.conftest import make_app, make_node


async def test_full_lifecycle(admin, session):
    await make_app(session, "alpha")

    first = (
        await admin.post(
            "/api/apps/alpha/nodes",
            json={"title": "Ingest", "detail": "Reads the feed.", "status": "done"},
        )
    ).json()
    second = (
        await admin.post("/api/apps/alpha/nodes", json={"title": "Index", "status": "todo"})
    ).json()

    edge = await admin.post(
        "/api/apps/alpha/edges",
        json={"source_id": first["id"], "target_id": second["id"]},
    )
    assert edge.status_code == 201

    patched = await admin.patch(
        f"/api/nodes/{second['id']}", json={"status": "wip", "title": "Indexing"}
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "wip"
    assert patched.json()["title"] == "Indexing"

    graph = (await admin.get("/api/apps/alpha/graph")).json()
    assert len(graph["nodes"]) == 2
    assert len(graph["edges"]) == 1

    assert (await admin.delete(f"/api/edges/{edge.json()['id']}")).status_code == 204
    assert (await admin.delete(f"/api/nodes/{second['id']}")).status_code == 204

    graph = (await admin.get("/api/apps/alpha/graph")).json()
    assert [node["title"] for node in graph["nodes"]] == ["Ingest"]
    assert graph["edges"] == []


async def test_patch_only_touches_supplied_fields(admin, session):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "Keep me", "wip")
    await admin.patch(f"/api/nodes/{node.id}", json={"detail": "Added later."})

    body = (await admin.patch(f"/api/nodes/{node.id}", json={})).json()
    assert body["title"] == "Keep me"
    assert body["status"] == "wip"
    assert body["detail"] == "Added later."


async def test_detail_can_be_cleared_explicitly(admin, session):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    await admin.patch(f"/api/nodes/{node.id}", json={"detail": "Something."})
    cleared = await admin.patch(f"/api/nodes/{node.id}", json={"detail": None})
    assert cleared.json()["detail"] is None


async def test_blank_detail_becomes_null(admin, session):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    assert (
        await admin.patch(f"/api/nodes/{node.id}", json={"detail": "   "})
    ).json()["detail"] is None


# --- the messages a person actually reads -----------------------------------


async def test_cycle_rejection_is_a_sentence_not_a_status_code(admin, session):
    app = await make_app(session, "alpha")
    first = await make_node(session, app, "Schema registry")
    second = await make_node(session, app, "Typed query builder")
    await admin.post(
        "/api/apps/alpha/edges", json={"source_id": first.id, "target_id": second.id}
    )

    response = await admin.post(
        "/api/apps/alpha/edges", json={"source_id": second.id, "target_id": first.id}
    )
    assert response.status_code == 422

    detail = response.json()["detail"]
    assert "loop" in detail
    assert "Schema registry" in detail and "Typed query builder" in detail
    assert "Unprocessable" not in detail


async def test_self_edge_message(admin, session):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    response = await admin.post(
        "/api/apps/alpha/edges", json={"source_id": node.id, "target_id": node.id}
    )
    assert response.json()["detail"] == "A feature cannot depend on itself."


async def test_cross_app_edge_message(admin, session):
    alpha = await make_app(session, "alpha")
    beta = await make_app(session, "beta")
    mine = await make_node(session, alpha, "Mine")
    theirs = await make_node(session, beta, "Theirs")

    response = await admin.post(
        "/api/apps/alpha/edges", json={"source_id": mine.id, "target_id": theirs.id}
    )
    assert response.status_code == 422
    assert "cannot cross between apps" in response.json()["detail"]


async def test_duplicate_edge_message(admin, session):
    app = await make_app(session, "alpha")
    a = await make_node(session, app, "A")
    b = await make_node(session, app, "B")
    await admin.post("/api/apps/alpha/edges", json={"source_id": a.id, "target_id": b.id})
    response = await admin.post(
        "/api/apps/alpha/edges", json={"source_id": a.id, "target_id": b.id}
    )
    assert response.json()["detail"] == "Those two features are already connected."


async def test_node_in_unknown_app_is_404(admin):
    response = await admin.post(
        "/api/apps/ghost/nodes", json={"title": "X", "status": "todo"}
    )
    assert response.status_code == 404


async def test_deleting_a_missing_node_is_404(admin):
    assert (await admin.delete("/api/nodes/4242")).status_code == 404
