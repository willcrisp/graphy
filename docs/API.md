# API reference

The complete REST surface: every endpoint, its request/response shape, and the
error format. This is the reference for someone (human or agent) working *on*
Blueprint — modifying a router, adding an endpoint, building an alternative
client.

If you're instead writing an agent that *imports data into* a running
Blueprint board (a Jira sync, say), read `GET /api/agent-instructions`
(rendered from `backend/app/instructions.py`) — it's a shorter, workflow-first
guide scoped to exactly that job, generated from this same codebase so it
can't drift on the status vocabulary. This document is the fuller picture:
every endpoint, not just the ones an importer needs, and the shapes behind
each one.

All request/response bodies are JSON. Schemas are defined in
`backend/app/schemas.py`; this document mirrors them but the code is the
source of truth if the two ever disagree.

## Conventions

- **Base path**: everything lives under `/api`.
- **Auth**: a single admin identity, carried by an `httpOnly` session cookie
  (`blueprint_session`). No API keys, no per-user accounts. See "Auth" below.
- **Errors**: every non-2xx response is `{"detail": "<message>"}`.
  - A `GraphError` (an invariant violation — a cycle, a duplicate edge, a
    cross-app connection) is **422**, and `detail` is a sentence written for a
    person, e.g. `"That connection would create a loop: 'A' already leads
    back to 'B'."` Treat it as informational, not as a code to branch on.
  - A `NotFoundError` (an app/node/edge id that doesn't exist) is **404**.
  - Pydantic validation failures (wrong type, blank title, bad status value)
    are FastAPI's own **422**, with `detail` as a list of `{msg, loc, ...}`
    objects rather than a string — `frontend/src/api.ts`'s
    `normaliseDetail` flattens both shapes to one sentence, worth copying if
    you write another client.
  - `require_writable` failing (global read-only mode) and `require_admin`
    failing (no/invalid session) are both **403**/**401** respectively, raised
    before a handler body ever runs.
- **Status vocabulary**: exactly `done`, `wip`, `todo`, `blocked`, enforced in
  three places that must stay in sync — the `CHECK` constraint in
  `models.py`, the `Status` Literal in `schemas.py`, and `STATUSES` in
  `frontend/src/types.ts`. See CLAUDE.md's "Conventions that will bite you."

## Auth

```
POST /api/auth/login
{"password": "<ROADMAP_ADMIN_PASSWORD>"}
-> 204, Set-Cookie: blueprint_session=...
```

```
POST /api/auth/logout
-> 204, cookie cleared
```

Login itself is behind `require_writable`: in a globally read-only deployment
it 403s, so there is no way to obtain an editing session at all. See
CLAUDE.md's "The read-only switch is two independent layers" for the full
picture, including why the client-side View/Edit toggle is not a security
boundary.

## Data model

- **App** — one independent board. `key` is a URL-safe slug chosen once at
  creation (from the name, de-duplicated by suffix) and never changes, so
  links keep working after a rename. `accent` is a stored hex colour, cycled
  from a fixed palette (`ACCENTS` in `services/graph.py`) unless one is given.
- **Node** ("task" everywhere user-facing) — belongs to exactly one app.
  `external_ref` is an opaque string, unique per app, meant for an external
  importer to recognise a node it already created (see `docs/API.md`'s sibling
  guide above); the UI never sets it.
- **Edge** ("dependency"/"connection" user-facing) — directed, `source_id ->
  target_id`, meaning source happens before target. Cannot cross apps, target
  itself, duplicate an existing edge, or close a cycle (DFS-checked on every
  create in `services/graph.py`).

## Endpoints

### Public — no auth required

| Method & path | Request body | Response |
|---|---|---|
| `GET /api/health` | — | `{"status": "ok"}` |
| `GET /api/apps` | — | `AppSummary[]` — every app plus its per-status task counts |
| `GET /api/apps/{key}/graph` | — | `GraphOut` — `{app, nodes, edges, last_updated}` for one board |
| `GET /api/config` | — | `{"readonly": bool, "authenticated": bool}` |
| `GET /api/agent-instructions` | — | `text/markdown` — the import-focused guide, not JSON |

### Auth

| Method & path | Request body | Response |
|---|---|---|
| `POST /api/auth/login` | `{"password": string}` | 204 + session cookie, or 401 with a generic failure message (never reveals whether the password was close) |
| `POST /api/auth/logout` | — | 204, cookie cleared |

### Admin — session cookie required, both guards from `routers/admin.py` apply

Every one of these returns the *whole updated board* — see "Every mutation is
applied twice" in CLAUDE.md for why: the client patches optimistically and
reconciles against exactly this response, so there is never a second request
after a write. `BoardOut` is `{graph, apps}`; the mutation-specific types below
add the one row that was written.

| Method & path | Request body | Response |
|---|---|---|
| `POST /api/apps` | `{"name": string, "accent"?: "#rrggbb"}` | `AppMutationOut` = `{app, apps}` |
| `PATCH /api/apps/{key}` | `{"name": string}` | `AppMutationOut` = `{app, apps}` |
| `DELETE /api/apps/{key}` | — | `AppsOut` = `{apps}` — 422 if it's the only app |
| `POST /api/apps/{key}/nodes` | `{"title": string, "detail"?: string\|null, "status": Status, "external_ref"?: string\|null}` | `NodeMutationOut` = `{node, graph, apps}` |
| `PATCH /api/nodes/{id}` | Same fields as create, all optional — **only fields present in the JSON body are touched** (`model_dump(exclude_unset=True)`); an explicit `"detail": null` clears it, an absent `detail` leaves it alone | `NodeMutationOut` = `{node, graph, apps}` |
| `DELETE /api/nodes/{id}` | — | `BoardOut` = `{graph, apps}` — cascades the node's edges; does **not** reparent its children, they become layout roots |
| `POST /api/apps/{key}/edges` | `{"source_id": int, "target_id": int}` | `EdgeMutationOut` = `{edge, graph, apps}` |
| `DELETE /api/edges/{id}` | — | `BoardOut` = `{graph, apps}` |

`AppSummary` = `AppOut` (`{id, key, name, accent, sort_order}`) plus
`counts: {done, wip, todo, blocked}`. `NodeOut` adds `id, app_id, title,
detail, status, external_ref, sort_order, created_at, updated_at` (timestamps
are UTC, always timezone-aware in the response even though SQLite stores them
naive — see `_as_utc` in `schemas.py`). `EdgeOut` is `{id, app_id, source_id,
target_id}`.

## Field validation

Enforced at the Pydantic boundary, before anything reaches the service layer
or the database:

- `title`: 1–200 chars, whitespace-trimmed, rejected if blank after trimming.
- `detail`, `external_ref`: optional, trimmed, empty string becomes `null`
  rather than being stored as `""`. `detail` max 2000 chars, `external_ref`
  max 200.
- `status`: must be one of the four values above.
- App `name`: 1–128 chars, trimmed. `accent`, if given, must match
  `^#[0-9A-Fa-f]{6}$`.

## Invariants (checked in `services/graph.py`, not the routers)

- No self-edges (`source_id == target_id`).
- No duplicate edges (same `source_id, target_id` pair).
- No cross-app edges — both endpoints must belong to the app in the URL.
- No cycles — a DFS from the proposed target checks whether it already
  reaches the proposed source before the edge is added.
- `external_ref` unique per app (not globally), checked in the service layer
  *and* by a DB unique constraint (`uq_node_app_external_ref`), so a race
  can't surface as a raw 500.
- The last app in the database cannot be deleted.

Every rule here applies identically to HTTP traffic, `scripts/seed.py`, and
the test suite — routers never validate independently, they just translate
`GraphError`/`NotFoundError` into the HTTP status codes above.
