# Blueprint

Feature roadmaps for six independent applications, rendered as interactive node
graphs. Public visitors get a read-only view; a single admin can sign in and edit
the graph in place.

Backend is FastAPI + SQLAlchemy over one SQLite file. Frontend is React +
TypeScript with React Flow and dagre. In production FastAPI serves the built
frontend, so the whole thing is one process on one port — no nginx, no Docker
required (though there is a Dockerfile).

```
backend/   FastAPI app, service layer, tests, seed and password scripts
frontend/  Vite SPA, design tokens, self-hosted IBM Plex subset
```

## Configuration

Every variable is named and commented in [`.env.example`](.env.example). Copy it
to `.env` and fill it in.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ROADMAP_SECRET_KEY` | **yes** | — | Signs the session cookie. Changing it logs the admin out. |
| `ROADMAP_ADMIN_PASSWORD_HASH` | **yes** | — | Argon2 hash of the admin password. Never a plaintext password. |
| `ROADMAP_DB_PATH` | no | `./blueprint.db` | SQLite file. Relative paths resolve against the working directory. |
| `ROADMAP_READONLY` | no | `false` | Global kill switch — see below. |
| `ROADMAP_SECURE_COOKIES` | no | `false` | Set `true` when serving over HTTPS. |
| `ROADMAP_STATIC_DIR` | no | unset | Directory of the built frontend. Set in production, leave unset in dev. |

The app **refuses to start** if either required variable is missing, naming the
one that is absent. It never generates a fallback secret — that would silently
invalidate every session on restart.

> `ROADMAP_ADMIN_PASSWORD_HASH` is required even when `ROADMAP_READONLY=true`. A
> purely public deployment still needs a hash it will never use; generate a
> throwaway one.

### Hashing a password

```bash
cd backend && uv run python scripts/hash_password.py
```

It prompts twice without echoing and prints the hash. Paste the whole thing —
starting `$argon2id$` — into `ROADMAP_ADMIN_PASSWORD_HASH`. Quote it if your
shell expands `$`. The plaintext is never written anywhere.

### Generating a secret key

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> **On Windows**, do not write `.env` with PowerShell's `Set-Content -Encoding utf8`
> — it emits a BOM, which `python-dotenv` parses into the *name* of the first
> variable, so the app reports that variable as missing. Use an editor that can
> save UTF-8 without a BOM.

## The read-only switch

Two independent layers, both of which must be satisfied before anything is written.

1. **`ROADMAP_READONLY=true`** — the deploy-time guarantee. Every mutating
   endpoint returns 403 regardless of session, login itself returns 403,
   `/api/config` reports `readonly: true`, and the frontend hides the sign-in
   entry point entirely.
2. **The View/Edit toggle** — client-side only, shown when authenticated and not
   globally read-only. It controls whether editing chrome appears, so an admin
   can browse without dragging something by accident. Persisted in
   `localStorage`, defaulting to View.

## Running in development

Two processes. The Vite dev server proxies `/api` to the backend, so leave
`ROADMAP_STATIC_DIR` unset.

Backend, from `backend/`:

```bash
uv run uvicorn app.main:app --env-file ../.env --reload --port 8000
```

Frontend, from `frontend/`:

```bash
npm install && npm run dev
```

Open <http://localhost:5173>.

### Seeding

```bash
cd backend && uv run --env-file ../.env python scripts/seed.py
```

Creates six apps with realistic feature trees — including a diamond-shaped
dependency in Lattice and one deliberately empty app (Tessellate) to exercise
the empty state. It skips apps that already exist; pass `--reset` to drop every
app first (which cascades to its nodes and edges).

### Tests

```bash
cd backend && uv run pytest
```

```bash
cd frontend && npx vitest run
```

The backend suite covers every invariant in the data model — cross-app edges,
self-edges, cycles, status validation at the API boundary, cascade-without-
reparenting, and the foreign-key pragma — plus auth, rate limiting, both
read-only layers, and static serving. The frontend suite covers dagre layout
ordering and stability.

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

Multi-stage: node builds the SPA, the runtime image is python-only. The SQLite
file lives on a volume at `/data`.

```bash
docker build -t blueprint .
```

```bash
docker run -p 8000:8000 --env-file .env -v blueprint-data:/data blueprint
```

The image sets `ROADMAP_DB_PATH=/data/blueprint.db` and
`ROADMAP_STATIC_DIR=/app/static`; your env file only needs the secret and the
password hash. The schema is created on first start, so an empty volume works.
To seed a running container:

```bash
docker exec -it <container> python scripts/seed.py
```

## Backing up

The database is a single file, but copying it while the app is running can catch
a partial write. Use SQLite's own online backup, which is safe against a live
writer:

```bash
sqlite3 /data/blueprint.db ".backup '/data/blueprint-$(date +%F).db'"
```

Restore by stopping the app and moving the backup into place. There is no
migration framework: the schema version lives in the `meta` table, and a schema
change means bumping it and writing a one-off script.

## Notes on the implementation

- **Layout is always computed.** Node positions are never persisted. Dagre runs
  on load and after every mutation, fed in a deterministic order so a given
  graph lays out identically across reloads.
- **Node dimensions are known before layout**, not measured from the DOM, which
  would make layout asynchronous and janky.
- **Every mutation refetches the graph.** At tens of nodes per app this is
  imperceptible and much simpler than optimistic patching.
- **Invariants live in the service layer**, not the routers, so the seed script
  and the tests are held to the same rules as HTTP traffic.
- **`PRAGMA foreign_keys=ON` is applied per connection.** SQLite defaults it off,
  and every `ON DELETE CASCADE` would silently do nothing without it.

### Two deliberate deviations from the spec

- **Status borders are 2px, not 1.5px.** Chrome floors a 1.5px border to 1px at
  `devicePixelRatio: 1`, which erased the hairline-versus-heavy distinction the
  drawing convention depends on. 2px keeps the hierarchy legible on ordinary
  displays as well as retina.
- **`--st-wip` and `--st-todo` have darkened text-only variants.** As specified
  they sit at 3.29:1 and 2.99:1 against `--ground`, below the 4.5:1 floor the
  accessibility requirements call non-negotiable. The specified hues are still
  used for borders, rails and marks; only text uses `--st-wip-ink` (5.12:1) and
  `--st-todo-ink` (5.21:1).
