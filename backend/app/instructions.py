"""Machine-readable usage guide for agents importing external work items.

Served verbatim by `GET /api/agent-instructions` (see `routers/public.py`) so a
person can hand an agent one URL instead of a prompt. It is generated, not a
static string, because `STATUSES` is one of the three places status values must
stay in sync (see CLAUDE.md) -- hardcoding a fourth copy here would just be
another way for that list to drift.
"""

from __future__ import annotations

from app.models import STATUSES

_STATUS_LIST = ", ".join(f"`{status}`" for status in STATUSES)


def render() -> str:
    return f"""# Blueprint agent guide

Blueprint is a roadmap API: a small set of **apps** (independent boards), each
holding **tasks** (nodes) connected by **dependencies** (directed edges). This
document is for an agent importing work items from an external tracker (e.g.
Jira) and keeping them in sync -- not for a human editing by hand.

## Authenticate

Every write goes through the router at `/api/*` that requires a session:

```
POST /api/auth/login
{{"password": "<ROADMAP_ADMIN_PASSWORD>"}}
```

The response sets a session cookie; send it back on every subsequent request
(an HTTP client with cookie persistence handles this automatically). Reads
(`GET`) need no auth.

Before writing anything, `GET /api/config` and check `readonly`. If it is
`true` the board is published read-only and every write -- including login --
returns 403. Stop; there is nothing importable to do.

## Data model

- **App** -- `key` (stable, URL-safe, chosen once), `name`. One app is one
  board; tasks and edges never cross between apps.
- **Task** (node) -- `title`, `detail` (free text, optional), `status` (one of
  {_STATUS_LIST}), and `external_ref`: an optional, opaque string unique
  *within its app*, meant for exactly this use case. Put the external
  tracker's id there (e.g. `"PROJ-123"`) and use it to recognise a task you
  already created, instead of matching on title.
- **Edge** -- `source_id -> target_id`, directed. This means source must
  happen before target -- "target depends on source". Edges cannot cross
  apps, point a task at itself, duplicate an existing edge, or close a cycle;
  the API rejects all of these with a 422 whose `detail` is a sentence meant
  to be read, e.g. `"That connection would create a loop: 'A' already leads
  back to 'B'."` Treat a rejected edge as informational and move on to the
  next one rather than aborting the whole import.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/apps` | List apps with per-status task counts. |
| `POST /api/apps` | Create an app. `{{"name": "..."}}`. |
| `GET /api/apps/{{key}}/graph` | Full board: app, all tasks, all edges. |
| `POST /api/apps/{{key}}/nodes` | Create a task. `{{"title", "detail"?, "status", "external_ref"?}}`. |
| `PATCH /api/nodes/{{id}}` | Update a task. Only the fields present are touched. |
| `DELETE /api/nodes/{{id}}` | Delete a task. Its edges cascade; its dependents are not reparented. |
| `POST /api/apps/{{key}}/edges` | Create an edge. `{{"source_id", "target_id"}}`. |
| `DELETE /api/edges/{{id}}` | Delete an edge. |

Every mutating endpoint returns the *whole* updated board (`{{graph, apps}}`),
plus the row it just wrote -- there is no need to re-fetch after a write.

## Importing tickets idempotently

A sync should be safe to re-run: it must update tickets it already imported
rather than duplicating them.

1. Pick the app for the tracker project -- reuse one by `key`, or
   `POST /api/apps` to create it if it doesn't exist yet.
2. `GET /api/apps/{{key}}/graph` and index the existing tasks by
   `external_ref`.
3. For each ticket:
   - If its id is already in that index, `PATCH /api/nodes/{{id}}` with
     whatever changed (title, detail, status).
   - Otherwise `POST /api/apps/{{key}}/nodes` with `external_ref` set to the
     ticket's id, so the next run recognises it.
4. Map the tracker's status vocabulary down to the four this API has
   ({_STATUS_LIST}) -- there is no fixed mapping, use judgement per project
   (e.g. "In Review" is usually `wip`, "Backlog" is usually `todo`).
5. For each same-project link between two tickets you've imported (e.g.
   "blocks"), resolve both ids via the `external_ref` index and
   `POST /api/apps/{{key}}/edges`. Skip links to tickets outside this project
   -- cross-app edges are always rejected. If an edge is rejected as a cycle,
   skip it and continue; do not treat it as fatal.
"""
