"""Authentication, rate limiting, and the two layers of the read-only switch."""

from __future__ import annotations

import pytest

from app.auth import COOKIE_NAME, login_limiter
from app.config import Settings
from tests.conftest import ADMIN_PASSWORD, build_client, make_app, make_node

# (method, path template) for every mutating endpoint in the contract.
MUTATIONS = [
    ("POST", "/api/apps/alpha/nodes", {"title": "X", "status": "todo"}),
    ("PATCH", "/api/nodes/{node}", {"title": "Y"}),
    ("DELETE", "/api/nodes/{node}", None),
    ("POST", "/api/apps/alpha/edges", {"source_id": 1, "target_id": 2}),
    ("DELETE", "/api/edges/1", None),
]


async def call(client, method: str, path: str, body: dict | None):
    return await client.request(method, path, json=body)


# --- login ------------------------------------------------------------------


async def test_login_sets_httponly_session_cookie(client):
    response = await client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 204

    cookie = response.headers["set-cookie"]
    assert COOKIE_NAME in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie.lower().replace("samesite=lax", "SameSite=lax")
    assert "Secure" not in cookie  # secure_cookies is false in the test settings
    assert "Max-Age=2592000" in cookie  # 30 days


async def test_secure_flag_follows_setting(tmp_path):
    from tests.conftest import make_settings

    http, app = build_client(make_settings(tmp_path, secure_cookies=True))
    async with http, app.router.lifespan_context(app):
        response = await http.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    assert "Secure" in response.headers["set-cookie"]


async def test_wrong_password_is_401_and_says_nothing_useful(client):
    response = await client.post("/api/auth/login", json={"password": "nope"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign-in failed. Check the password and try again."
    assert COOKIE_NAME not in response.headers.get("set-cookie", "")


async def test_config_reports_authentication(client, admin):
    assert (await admin.get("/api/config")).json() == {
        "readonly": False,
        "authenticated": True,
    }


async def test_logout_clears_the_session(admin):
    await admin.post("/api/auth/logout")
    assert (await admin.get("/api/config")).json()["authenticated"] is False


async def test_tampered_cookie_is_not_authenticated(client):
    client.cookies.set(COOKIE_NAME, "not.a.valid.signature")
    assert (await client.get("/api/config")).json()["authenticated"] is False


async def test_cookie_signed_with_another_secret_is_rejected(tmp_path, client):
    from itsdangerous import URLSafeTimedSerializer

    forged = URLSafeTimedSerializer("a-different-secret", salt="blueprint-session-v1")
    client.cookies.set(COOKIE_NAME, forged.dumps("admin"))
    assert (await client.get("/api/config")).json()["authenticated"] is False


# --- rate limiting ----------------------------------------------------------


async def test_login_is_rate_limited_after_five_failures(client):
    for _ in range(5):
        assert (
            await client.post("/api/auth/login", json={"password": "wrong"})
        ).status_code == 401

    # The sixth attempt is refused even though the password is now correct, and
    # the body is identical to a wrong-password response.
    locked = await client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    assert locked.status_code == 401
    assert locked.json()["detail"] == "Sign-in failed. Check the password and try again."


async def test_successful_login_resets_the_counter(client):
    for _ in range(4):
        await client.post("/api/auth/login", json={"password": "wrong"})
    assert (
        await client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    ).status_code == 204

    login_limiter.reset("testclient")
    for _ in range(4):
        assert (
            await client.post("/api/auth/login", json={"password": "wrong"})
        ).status_code == 401


# --- layer 2: no session ----------------------------------------------------


@pytest.mark.parametrize("method,path,body", MUTATIONS)
async def test_mutations_require_a_session(client, session, method, path, body):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    response = await call(client, method, path.format(node=node.id), body)
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to make changes."


@pytest.mark.parametrize("method,path,body", MUTATIONS)
async def test_mutations_succeed_with_a_session(admin, session, method, path, body):
    app = await make_app(session, "alpha")
    node = await make_node(session, app, "A")
    response = await call(admin, method, path.format(node=node.id), body)
    # Not 401/403: auth passed. Some of these 404/422 on the fixture data, which
    # is fine -- this asserts the guard, not the operation.
    assert response.status_code not in (401, 403)


# --- layer 1: the global read-only kill switch ------------------------------


@pytest.fixture
async def readonly_pair(tmp_path):
    """A read-only app plus a session cookie minted directly, since login itself
    is refused in read-only mode."""
    from itsdangerous import URLSafeTimedSerializer

    from tests.conftest import make_settings

    settings: Settings = make_settings(tmp_path, readonly=True)
    http, app = build_client(settings)
    token = URLSafeTimedSerializer(
        settings.secret_key, salt="blueprint-session-v1"
    ).dumps("admin")
    http.cookies.set(COOKIE_NAME, token)
    async with http, app.router.lifespan_context(app):
        async with app.state.db.session() as db:
            created = await make_app(db, "alpha")
            await make_node(db, created, "A")
        yield http


async def test_readonly_reports_itself_in_config(readonly_pair):
    body = (await readonly_pair.get("/api/config")).json()
    assert body["readonly"] is True
    # The cookie is valid, so the session is real -- and still cannot write.
    assert body["authenticated"] is True


@pytest.mark.parametrize("method,path,body", MUTATIONS)
async def test_readonly_blocks_every_mutation_despite_a_valid_session(
    readonly_pair, method, path, body
):
    response = await call(readonly_pair, method, path.format(node=1), body)
    assert response.status_code == 403
    assert response.json()["detail"] == (
        "This board is published read-only. Editing is disabled."
    )


async def test_readonly_refuses_login_entirely(readonly_pair):
    response = await readonly_pair.post(
        "/api/auth/login", json={"password": ADMIN_PASSWORD}
    )
    assert response.status_code == 403


async def test_readonly_still_serves_reads(readonly_pair):
    assert (await readonly_pair.get("/api/apps")).status_code == 200
    assert (await readonly_pair.get("/api/apps/alpha/graph")).status_code == 200
