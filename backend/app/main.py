"""FastAPI application: startup checks, API routes, static mount."""

from __future__ import annotations

import sys

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Blueprint", docs_url=None, redoc_url=None)
    app.state.settings = settings

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    _mount_static(app, settings)
    return app


def _mount_static(app: FastAPI, settings: Settings) -> None:
    """Serve the built SPA, falling back to index.html for client-side routes."""
    if settings.static_dir is None:
        return

    index = settings.static_dir / "index.html"
    app.mount(
        "/assets",
        StaticFiles(directory=settings.static_dir / "assets"),
        name="assets",
    )

    @app.exception_handler(StarletteHTTPException)
    async def spa_fallback(request, exc: StarletteHTTPException):
        is_missing_page = (
            exc.status_code == 404
            and request.method == "GET"
            and not request.url.path.startswith("/api/")
        )
        if is_missing_page and index.is_file():
            return FileResponse(index)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.get("/{_path:path}", include_in_schema=False)
    async def spa_index(_path: str) -> FileResponse:
        candidate = (settings.static_dir / _path).resolve()
        if _path and candidate.is_file() and candidate.is_relative_to(settings.static_dir):
            return FileResponse(candidate)
        return FileResponse(index)


def _settings_or_exit() -> Settings:
    try:
        return load_settings()
    except ConfigError as exc:
        print(f"blueprint: refusing to start - {exc}", file=sys.stderr)
        raise SystemExit(1) from None


app = create_app(_settings_or_exit())
