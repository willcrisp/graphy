"""FastAPI application: startup checks, API routes, static mount."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import ConfigError, Settings, load_settings
from app.db import Database
from app.routers import admin, auth, public
from app.services.graph import GraphError, NotFoundError


def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = Database(settings.db_url)
        await database.create_all()
        app.state.db = database
        try:
            yield
        finally:
            await database.dispose()

    app = FastAPI(title="Blueprint", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.settings = settings

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(public.router)
    app.include_router(auth.router)
    app.include_router(admin.router)

    # Invariant violations carry a message written for a person to read; pass it
    # through verbatim rather than letting it become "422 Unprocessable Entity".
    @app.exception_handler(GraphError)
    async def _graph_error(_request: Request, exc: GraphError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(NotFoundError)
    async def _not_found(_request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=404)

    _mount_static(app, settings)
    return app


def _mount_static(app: FastAPI, settings: Settings) -> None:
    """Serve the built SPA, falling back to index.html for client-side routes."""
    if settings.static_dir is None:
        return

    root = settings.static_dir
    index = root / "index.html"
    if (root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    # Python's mimetypes registry has no woff2 entry on some platforms, and a
    # font served as application/octet-stream is treated as an opaque download.
    extra_types = {".woff2": "font/woff2", ".woff": "font/woff"}

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        # An unknown /api/* path is a client error, not a page. Falling through
        # to index.html would hand a fetch() a 200 full of HTML.
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found."}, status_code=404)

        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(
                candidate, media_type=extra_types.get(candidate.suffix.lower())
            )
        return FileResponse(index)

    @app.exception_handler(StarletteHTTPException)
    async def _spa_fallback(request: Request, exc: StarletteHTTPException):
        unknown_page = (
            exc.status_code == 404
            and request.method == "GET"
            and not request.url.path.startswith("/api/")
        )
        if unknown_page and index.is_file():
            return FileResponse(index)
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


def _settings_or_exit() -> Settings:
    try:
        return load_settings()
    except ConfigError as exc:
        print(f"blueprint: refusing to start - {exc}", file=sys.stderr)
        raise SystemExit(1) from None


def __getattr__(name: str):
    """Build the ASGI app only when something actually asks for `app.main:app`.

    Uvicorn resolves the target with getattr, so this still works. Importing the
    module — as the tests do, to reach `create_app` — no longer requires the
    production environment to be present.
    """
    if name == "app":
        return create_app(_settings_or_exit())
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
