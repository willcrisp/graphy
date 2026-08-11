"""Serving the built SPA from the same process as the API."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.conftest import build_client, make_settings


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>Blueprint</title>")
    (root / "assets" / "index-abc.js").write_text("console.log(1)")
    (root / "fonts").mkdir()
    (root / "fonts" / "plex.woff2").write_bytes(b"wOF2fake")
    return root


@pytest.fixture
async def served(tmp_path: Path, dist: Path):
    http, app = build_client(make_settings(tmp_path, static_dir=dist))
    async with http, app.router.lifespan_context(app):
        yield http


async def test_index_is_served_at_root(served):
    response = await served.get("/")
    assert response.status_code == 200
    assert "Blueprint" in response.text


@pytest.mark.parametrize("path", ["/a/atmosphere", "/a/tessellate", "/anything/deep"])
async def test_client_routes_fall_back_to_index(served, path):
    response = await served.get(path)
    assert response.status_code == 200
    assert "<!doctype html>" in response.text


async def test_real_assets_are_served(served):
    assert (await served.get("/assets/index-abc.js")).status_code == 200


async def test_woff2_gets_a_font_content_type(served):
    response = await served.get("/fonts/plex.woff2")
    assert response.status_code == 200
    assert response.headers["content-type"] == "font/woff2"


async def test_unknown_api_path_is_json_404_not_the_spa(served):
    """Falling through to index.html would hand a fetch() 200 OK full of HTML."""
    response = await served.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


async def test_api_still_works_alongside_the_spa(served):
    assert (await served.get("/api/health")).json() == {"status": "ok"}
    assert (await served.get("/api/apps")).status_code == 200


async def test_path_traversal_does_not_escape_the_static_root(served, tmp_path):
    (tmp_path / "secret.txt").write_text("do not serve me")
    response = await served.get("/../secret.txt")
    assert "do not serve me" not in response.text


async def test_missing_static_dir_is_a_config_error(tmp_path):
    import os

    from app.config import ConfigError, load_settings

    previous = dict(os.environ)
    os.environ.update(
        ROADMAP_SECRET_KEY="k",
        ROADMAP_ADMIN_PASSWORD_HASH="h",
        ROADMAP_STATIC_DIR=str(tmp_path / "nope"),
    )
    try:
        with pytest.raises(ConfigError, match="not a directory"):
            load_settings()
    finally:
        os.environ.clear()
        os.environ.update(previous)
