# Blueprint

Feature roadmaps for six independent applications, rendered as interactive node
graphs. Public visitors get a clean read-only view; a single admin can sign in and
edit the graph in place.

FastAPI + SQLAlchemy over one SQLite file, with a React + TypeScript frontend using
React Flow and dagre. In production FastAPI serves the built frontend, so the whole
thing is **one process on one port** — no nginx, no Docker required.

---

## Getting started

### 1. Prerequisites

| | Version | Check |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | any recent | `uv --version` |
| Node | 18 or newer | `node --version` |

Nothing else. No database server, no Redis, no Docker.

> Node 18 is fine and is what the pinned Vite 5 / Vitest 2 target. If you're on
> Node 20+ everything still works; just don't bump those two without checking.

### 2. Install dependencies

```bash
cd backend && uv sync
```

```bash
cd frontend && npm install
```

### 3. Create your `.env`

The app **refuses to start** without a secret key and an admin password, and
never invents a fallback. Create `.env` in the repository root:

```bash
cp .env.example .env
```

Open it and fill in two values:

- `ROADMAP_SECRET_KEY` — any long random string. Generate one with
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- `ROADMAP_ADMIN_PASSWORD` — the admin password, in plaintext. `.env` is
  gitignored; treat it as the secret.

> **Windows:** don't write `.env` with PowerShell's `Set-Content -Encoding utf8`.
> It emits a BOM, which `python-dotenv` parses into the *name* of the first
> variable — so the app reports that variable as missing even though it's right
> there. Use an editor that saves UTF-8 without a BOM.

### 4. Seed some data

```bash
cd backend && uv run --env-file ../.env python scripts/seed.py
```

Creates six apps with realistic feature trees, including a diamond-shaped dependency
in Lattice and one deliberately empty app (Tessellate) so you can see the empty
state. Re-running skips apps that already exist; pass `--reset` to drop everything
first.

### 5. Run it

Two terminals. Backend:

```bash
cd backend && uv run uvicorn app.main:app --env-file ../.env --reload --port 8000
```

Frontend:

```bash
cd frontend && npm run dev
```

Open **<http://localhost:5173>**. Click **Sign in** at the top right and enter the
password you hashed in step 3 — you'll get a View/Edit toggle and can start editing.

### 6. Run the tests

```bash
cd backend && uv run pytest
```

```bash
cd frontend && npx vitest run
```

The backend suite needs no environment set; it builds its own settings and uses a
throwaway database per test.

---

## How it works

**Six apps, one graph each.** The URL carries the app key (`/a/atmosphere`), so any
view is linkable. Tabs across the top switch between them.

**Layout is always computed.** Node positions are never stored. Dagre runs on load
and after every mutation, fed in a deterministic order so a given graph lays out
identically across reloads.

**Editing is direct.** Click a node to open the side panel; in Edit mode the fields
become editable and save on blur. New nodes appear unconnected — drag from a node's
right handle to another node's left handle to connect them. Deleting is behind a
confirm step, never a keyboard shortcut.

**The graph can't tie itself in knots.** Edges that would cross between apps, point a
node at itself, duplicate an existing link, or close a loop are all rejected, and the
panel explains why in plain language rather than showing a status code.

## Configuration

Every variable is documented in [`.env.example`](.env.example).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ROADMAP_SECRET_KEY` | **yes** | — | Signs the session cookie. Changing it signs the admin out. |
| `ROADMAP_ADMIN_PASSWORD` | **yes** | — | The admin password, in plaintext. |
| `ROADMAP_DB_PATH` | no | `./blueprint.db` | SQLite file. Relative paths resolve against the working directory. |
| `ROADMAP_READONLY` | no | `false` | Global kill switch — see below. |
| `ROADMAP_SECURE_COOKIES` | no | `false` | Set `true` when serving over HTTPS. |
| `ROADMAP_STATIC_DIR` | no | unset | Directory of the built frontend. Set in production, leave unset in dev. |

> `ROADMAP_ADMIN_PASSWORD` is required even when `ROADMAP_READONLY=true`. A
> purely public deployment still needs a password it will never use — set a
> throwaway one.

### Publishing read-only

Two independent layers, both of which must be satisfied before anything is written.

1. **`ROADMAP_READONLY=true`** is the deploy-time guarantee. Every mutating endpoint
   returns 403 regardless of session, login itself returns 403, and the frontend
   hides the sign-in entry point entirely.
2. **The View/Edit toggle** is client-side only, shown when signed in and not
   globally read-only. It controls whether editing chrome appears, so an admin can
   browse without dragging something by accident. Persisted in `localStorage`,
   defaulting to View.

## Running in production

Build the frontend, then point the backend at it. One process, one port.

```bash
cd frontend && npm run build
```

```bash
cd backend && ROADMAP_STATIC_DIR=../frontend/dist uv run uvicorn app.main:app --env-file ../.env --host 0.0.0.0 --port 8000
```

FastAPI serves `index.html` for client-side routes such as `/a/atmosphere`, real
files for anything that exists on disk, and JSON 404s for unknown `/api/*` paths.

### Docker

Multi-stage: node builds the SPA, the runtime image is python-only. The SQLite file
lives on a volume at `/data`.

```bash
docker build -t blueprint .
```

```bash
docker run -p 8000:8000 --env-file .env -v blueprint-data:/data blueprint
```

The image sets `ROADMAP_DB_PATH` and `ROADMAP_STATIC_DIR` itself, so your env file
only needs the secret and the password hash. The schema is created on first start,
so an empty volume works. To seed a running container:

```bash
docker exec -it <container> python scripts/seed.py
```

> The Dockerfile has not been built and run end to end — the Docker daemon was
> unavailable in the environment where it was written. The runtime configuration it
> encodes (fresh empty data directory, schema creation on first start, single-port
> static serving) was verified directly; the image build itself has not been.

### Backing up

The database is a single file, but copying it while the app is running can catch a
partial write. Use SQLite's own online backup, which is safe against a live writer:

```bash
sqlite3 /data/blueprint.db ".backup '/data/blueprint-$(date +%F).db'"
```

Restore by stopping the app and moving the backup into place. There is no migration
framework: the schema version lives in the `meta` table, and a schema change means
bumping it and writing a one-off script.

## API

Public, no auth:

```
GET  /api/health                -> {"status": "ok"}
GET  /api/apps                  -> apps with per-status counts
GET  /api/apps/{key}/graph      -> {app, nodes, edges, last_updated}
GET  /api/config                -> {readonly, authenticated}
```

Admin, session cookie required:

```
POST   /api/auth/login          {password} -> 204 + Set-Cookie
POST   /api/auth/logout         -> 204
POST   /api/apps/{key}/nodes    {title, detail?, status} -> node
PATCH  /api/nodes/{id}          {title?, detail?, status?} -> node
DELETE /api/nodes/{id}          -> 204
POST   /api/apps/{key}/edges    {source_id, target_id} -> edge
DELETE /api/edges/{id}          -> 204
```

## Repository layout

```
backend/
  app/
    main.py       FastAPI app, static mount, exception handlers
    config.py     env parsing, fail-fast validation
    db.py         engine, session factory, FK pragma
    models.py     four tables: app, node, edge, meta
    schemas.py    pydantic; status enum enforced here
    auth.py       session cookie, password check, guards
    services/     graph invariants -- cycle check lives here
    routers/      public / auth / admin
  scripts/        seed.py
  tests/
frontend/
  src/
    layout.ts     dagre wrapper; node dimensions computed, not measured
    theme.ts      light/dark resolution and persistence
    api.ts        typed client, flattens server errors to one sentence
    components/   Graph, FeatureNode, AppTabs, DetailPanel, TitleBlock, ...
    styles/       tokens.css (design tokens), app.css
  public/fonts/   self-hosted IBM Plex subset
```

Working on this with Claude Code? See [CLAUDE.md](CLAUDE.md) for the architectural
decisions and the conventions that will bite you.

## Implementation notes

- **Invariants live in the service layer**, not the routers, so the seed script and
  the tests are held to the same rules as HTTP traffic.
- **`PRAGMA foreign_keys=ON` is applied per connection.** SQLite defaults it off, and
  every `ON DELETE CASCADE` would silently do nothing without it.
- **Deleting a node does not reparent its children.** They become roots of the
  layout. This is intended, and tested.
- **Node dimensions are known before layout**, not measured from the DOM, which would
  make layout asynchronous and janky.
- **Every mutation refetches the graph.** At tens of nodes per app this is
  imperceptible and much simpler than optimistic patching.
- **The board follows your OS light/dark setting**, and the toggle in the top right
  overrides it for good (kept in `localStorage`). The theme is resolved before first
  paint, so there is no flash of the light board on a dark desktop. Dark is a full
  re-pick of the palette rather than an inversion: the four status hues are chosen
  again against the dark ground, where the light ones drop as low as 1.6:1, and each
  per-app accent is mixed toward white for drawing while the stored hex is left
  alone.

### Two deliberate deviations from the design spec

- **Status borders are 2px, not the specified 1.5px.** Chrome floors a 1.5px border
  to 1px at `devicePixelRatio: 1`, which erased the hairline-versus-heavy distinction
  the drawing convention depends on. 2px keeps the hierarchy legible on ordinary
  displays as well as retina.
- **`--st-wip` and `--st-todo` have darkened text-only variants.** As specified they
  sit at 3.29:1 and 2.99:1 against `--ground`, below the 4.5:1 contrast floor. The
  specified hues are still used for borders, rails and marks; only text uses
  `--st-wip-ink` (5.12:1) and `--st-todo-ink` (5.21:1). In dark the status hues are
  re-picked and all four clear the floor as drawn (5.9, 8.1, 5.6, 5.3 against
  `--ground`), so the `-ink` tokens there are aliases.
