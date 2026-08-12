from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import App, Edge, Node, Parent  # noqa: E402

ADMIN_PASSWORD = "correct horse battery staple"


def make_settings(tmp_path: Path, **overrides) -> Settings:
    defaults = dict(
        secret_key="test-secret-key",
        admin_password=ADMIN_PASSWORD,
        db_path=tmp_path / "test.db",
        readonly=False,
        secure_cookies=False,
        static_dir=None,
    )
    return Settings(**{**defaults, **overrides})


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
async def database(settings: Settings) -> AsyncIterator[Database]:
    db = Database(settings.db_url)
    await db.create_all()
    yield db
    await db.dispose()


@pytest.fixture
async def session(database: Database) -> AsyncIterator[AsyncSession]:
    async with database.session() as session:
        yield session


def build_client(settings: Settings) -> tuple[AsyncClient, object]:
    app = create_app(settings)
    return (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test"),
        app,
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    http, app = build_client(settings)
    async with http, app.router.lifespan_context(app):  # type: ignore[attr-defined]
        yield http


@pytest.fixture
async def admin(client: AsyncClient) -> AsyncClient:
    """A client carrying a valid admin session cookie."""
    response = await client.post("/api/auth/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 204, response.text
    return client


async def make_parent(
    session: AsyncSession, name: str = "Platform", detail: str | None = None, **kwargs
) -> Parent:
    parent = Parent(name=name, detail=detail, sort_order=kwargs.get("sort_order", 0))
    session.add(parent)
    await session.commit()
    await session.refresh(parent)
    return parent


async def make_app(session: AsyncSession, key: str = "alpha", **kwargs) -> App:
    app = App(
        key=key,
        name=kwargs.get("name", key.title()),
        accent=kwargs.get("accent", "#1F5F8B"),
        parent_id=kwargs.get("parent_id"),
        sort_order=kwargs.get("sort_order", 0),
    )
    session.add(app)
    await session.commit()
    await session.refresh(app)
    return app


async def make_node(
    session: AsyncSession, app: App, title: str, status: str = "todo"
) -> Node:
    node = Node(app_id=app.id, title=title, status=status)
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return node


async def make_edge(session: AsyncSession, app: App, source: Node, target: Node) -> Edge:
    edge = Edge(app_id=app.id, source_id=source.id, target_id=target.id)
    session.add(edge)
    await session.commit()
    await session.refresh(edge)
    return edge
