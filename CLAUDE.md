# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All backend commands run from `backend/`, all frontend commands from `frontend/`.

```bash
# Backend: dev server (needs ../.env; --env-file is what loads it)
uv run uvicorn app.main:app --env-file ../.env --reload --port 8000

# Backend: tests. No environment needed -- tests construct Settings directly.
uv run pytest
uv run pytest tests/test_invariants.py                        # one file
uv run pytest tests/test_invariants.py::test_self_edge_is_rejected   # one test
uv run pytest -k cycle                                        # by name

# Backend: seed six apps (--reset drops every app first)
uv run --env-file ../.env python scripts/seed.py
uv run --env-file ../.env python scripts/seed.py --reset

# Backend: generate a hash for ROADMAP_ADMIN_PASSWORD_HASH
uv run python scripts/hash_password.py
```

```bash
# Frontend
npm run dev            # :5173, proxies /api -> 127.0.0.1:8000
npm run build          # tsc -b && vite build -- this is also the typecheck
npx vitest run
npx vitest run -t "assigns increasing ranks"   # one test by name
```

There is no linter or formatter configured. `npm run build` is the only type check.

Node is pinned below 20 in practice: **Vite 5 and Vitest 2 are deliberate** — Vite 6+ and Vitest 3+ require Node 20, and this environment has Node 18. Don't upgrade them without checking the Node version.

## Architecture

### The read-only switch is two independent layers

Understanding this requires `auth.py`, `routers/admin.py`, and `App.tsx` together.

1. `require_writable` (global `ROADMAP_READONLY`) and `require_admin` (session) are
   both **router-level** dependencies on `routers/admin.py`, listed in that order.
   `require_writable` runs first, so a valid session still gets 403 when the board
   is published read-only. New mutating endpoints added to that router inherit both
   guards automatically — this is why they are on the router and not per-endpoint.
2. The View/Edit toggle is client-side only and controls whether editing chrome
   renders. It is never a security boundary.

`routers/auth.py` calls `require_writable` explicitly, so login itself 403s in
read-only mode. Tests that need a session under read-only must mint the cookie
directly with `URLSafeTimedSerializer` (see the `readonly_pair` fixture).

### Invariants live in the service layer

`services/graph.py` owns every rule — no cross-app edges, no self-edges, DFS cycle
check, no duplicate edges. Routers do not validate. This is deliberate: the seed
script and tests exercise the same rules as HTTP traffic.

`GraphError` → 422 and `NotFoundError` → 404 via exception handlers in `main.py`
that pass `str(exc)` through **verbatim**. Those messages are user-facing prose
rendered directly in the detail panel — the cycle message names both features by
title. Write new ones as sentences a person reads, not as error codes.

### `app.main:app` is lazily constructed

`main.py` defines a module-level `__getattr__` (PEP 562) so `app` is only built when
something actually resolves `app.main:app`. Uvicorn does this via getattr, so it
works; importing the module to reach `create_app` (as the tests do) does not require
the production environment. **Don't replace it with a plain `app = create_app(...)`** —
that breaks the entire test suite at import time.

`create_app(settings)` takes settings as an argument; the DB is created in the
lifespan and hangs off `app.state.db`.

### Layout is computed, never persisted

`frontend/src/layout.ts` runs dagre on load and after every mutation. Node positions
are never stored.

Node dimensions must be known **before** layout — heights are derived arithmetically
in `nodeHeight()` and never measured from the DOM. `.feature { height: 100% }` in
`app.css` makes the drawn node fill whatever box `layout.ts` reserved, so small drift
between the arithmetic and the real type metrics can't cause clipping. If you change
node padding, font size, or line height, re-check the constants at the top of
`layout.ts`.

Nodes are fed to dagre in `sort_order`-then-`id` order and edges in `id` order,
because dagre's output depends on insertion order and layout stability across
reloads is a tested requirement.

### Every mutation refetches the whole graph

`runMutation` in `App.tsx` calls the API, then `refresh()` re-fetches both the graph
and the app list (for the title-block counts). There is no optimistic patching. At
tens of nodes per app this is imperceptible and much simpler.

### SQLite foreign keys

`db.py` attaches `PRAGMA foreign_keys=ON` to the connection pool's `connect` event,
so it applies to **every** connection. SQLite defaults it off and every
`ON DELETE CASCADE` would silently no-op without it. `test_invariants.py` proves it's
working by asserting an orphan insert raises `IntegrityError`.

Deleting a node cascades its edges but does **not** reparent its children — they
become roots of the layout. This is intended behaviour with a test asserting it.

## Conventions that will bite you

**Status is defined in three places that must stay in sync:** the `CHECK` constraint
in `models.py`, the `Status` Literal in `schemas.py` (which is what produces the 422
at the API boundary), and `STATUSES` in `frontend/src/types.ts`.

**Two token pairs are not interchangeable.** `--st-wip` / `--st-todo` are the drawing
colours for borders, rails, and marks. `--st-wip-ink` / `--st-todo-ink` are darkened
variants used for **text only**, because the drawing colours fall below the 4.5:1
contrast floor against `--ground`. Using the wrong one for text reintroduces an
accessibility failure. `done` and `blocked` pass as-is and have no variant.

**Borders are 2px, not 1.5px.** Chrome floors a 1.5px border to 1px at
`devicePixelRatio: 1`, which erases the hairline-versus-heavy distinction the status
convention depends on. `todo` is the only 1px status.

**React Flow's stylesheet outguns naive selectors.** It ships
`.react-flow__node.selectable:focus-visible { outline: none }` at specificity 0-3-0.
Overrides for React Flow internals need matching specificity or they vanish silently.

**Adding a dependency is a project-level decision.** The stack is deliberately fixed:
no Redis, Postgres, Alembic, state management library, component library, or CSS
framework. Styling is hand-written CSS with custom properties.

## Environment

Required: `ROADMAP_SECRET_KEY`, `ROADMAP_ADMIN_PASSWORD_HASH` (argon2 hash, never
plaintext). The app refuses to start without them and names the missing one — it
never generates a fallback secret. Optional: `ROADMAP_DB_PATH`, `ROADMAP_READONLY`,
`ROADMAP_SECURE_COOKIES`, `ROADMAP_STATIC_DIR`. All documented in `.env.example`.

Set `ROADMAP_STATIC_DIR` to `frontend/dist` for production single-port serving; leave
it unset in development so the Vite proxy handles `/api`.

**On Windows, do not write `.env` with PowerShell's `Set-Content -Encoding utf8`** —
it emits a BOM that `python-dotenv` parses into the *name* of the first variable, so
the app reports that variable as missing.

## Tests

`tests/conftest.py`: the `session` and `client` fixtures point at the **same** tmp
SQLite file, so you can seed through `session` and read the result through `client`
in one test. Helpers `make_app`, `make_node`, `make_edge` insert directly; the `admin`
fixture returns a client carrying a valid session cookie.

The login rate limiter is a module-level singleton, so an autouse fixture clears it
between tests. Anything new touching `login_limiter` must account for that.
