# Stage 1: build the SPA.
FROM node:20-alpine AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: python runtime. No node, no build tools in the final image.
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.6.10 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/scripts ./scripts
RUN uv sync --frozen --no-dev

COPY --from=web /build/dist ./static

# The SQLite file lives on a volume; everything else in the image is read-only
# in practice. ROADMAP_DB_PATH must point inside this directory.
RUN mkdir -p /data && useradd --system --uid 10001 blueprint && chown blueprint /data
VOLUME ["/data"]
USER blueprint

ENV ROADMAP_DB_PATH=/data/blueprint.db \
    ROADMAP_STATIC_DIR=/app/static

EXPOSE 8000

# ROADMAP_SECRET_KEY and ROADMAP_ADMIN_PASSWORD are deliberately not set
# here -- the app refuses to start without them, which is the intended failure.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
