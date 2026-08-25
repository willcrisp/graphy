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

- **App** -- `key` (stable, URL-safe, chosen once), `name`, and an optional
  `parent_id`. One app is one board; tasks and edges never cross between apps.
- **Parent project** -- `name` (unique) and `detail`, and nothing else. Several
  apps can point at the same one, which is how the overview canvas joins
  otherwise-independent boards. Optional: an app with `parent_id: null` is
  standalone. Deleting a parent project detaches its apps; it never deletes a
  board.
- **Task** (node) -- `title`, `detail` (free text, optional), `status` (one of
  {_STATUS_LIST}), and `external_ref`: an optional, opaque string unique
  *within its app*, meant for exactly this use case. Put the external
  tracker's id there (e.g. `"PROJ-123"`) and use it to recognise a task you
  already created, instead of matching on title.
- **Milestone** -- a dated line across one board: `label` (e.g. `"Q1 2026"`),
  optional `due_on` (a plain calendar date, `"2026-03-31"`), and `position`,
  which is the order, low to high. A task's `milestone_id` says which line it
  is due by; `null` means no date is committed, which is a normal state and
  not an incomplete one.
- **Edge** -- `source_id -> target_id`, directed. This means source must
  happen before target -- "target depends on source". Edges cannot cross
  apps, point a task at itself, duplicate an existing edge, or close a cycle;
  the API rejects all of these with a 422 whose `detail` is a sentence meant
  to be read, e.g. `"That connection would create a loop: 'A' already leads
  back to 'B'."` Treat a rejected edge as informational and move on to the
  next one rather than aborting the whole import.

  One further rule involves both edges and milestones: **nothing may depend on
  work scheduled after it.** If a task is due by Q1 and something it depends on
  is due by Q2 -- directly or through a chain -- the edge is refused, because
  that plan cannot happen. Undated tasks are exempt in both directions. This
  bites an import that maps due dates and links in the same pass, so import the
  links first and the dates second if the tracker's data disagrees with itself.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/apps` | List apps with per-status task counts. |
| `POST /api/apps` | Create an app. `{{"name": "..."}}`. |
| `GET /api/overview` | Every board at once: parents, apps, all tasks, all edges. |
| `GET /api/parents` | List parent projects. |
| `POST /api/parents` | Create one. `{{"name", "detail"?}}`. |
| `PATCH /api/parents/{{id}}` | Update one. Only the fields present are touched. |
| `DELETE /api/parents/{{id}}` | Delete one. Its apps are detached, not deleted. |
| `PUT /api/apps/{{key}}/parent` | Attach a board. `{{"parent_id": 3}}`, or `null` to detach. |
| `GET /api/apps/{{key}}/graph` | Full board: app, all tasks, all edges, all milestones. |
| `POST /api/apps/{{key}}/milestones` | Create a milestone, appended last. `{{"label", "due_on"?}}`. |
| `PATCH /api/milestones/{{id}}` | Update one. `position` is an *index* into the board's run, not a stored number. |
| `DELETE /api/milestones/{{id}}` | Delete one. Tasks due by it survive, undated. |
| `POST /api/apps/{{key}}/nodes` | Create a task. `{{"title", "detail"?, "status", "external_ref"?, "milestone_id"?}}`. |
| `PATCH /api/nodes/{{id}}` | Update a task. Only the fields present are touched. |
| `DELETE /api/nodes/{{id}}` | Delete a task. Its edges cascade; its dependents are not reparented. |
| `POST /api/apps/{{key}}/edges` | Create an edge. `{{"source_id", "target_id"}}`. |
| `DELETE /api/edges/{{id}}` | Delete an edge. |

Every mutating endpoint returns the *whole* updated board (`{{graph, apps}}`),
plus the row it just wrote -- there is no need to re-fetch after a write. The
parent-project endpoints are the exception in shape only: they answer with the
whole overview (`{{parents, apps, nodes, edges, last_updated}}`), because what
they change is the structure *between* boards rather than the contents of one.

## Grouping boards under a parent project

Only worth doing if the external tracker has a layer above its projects (an
epic hierarchy, a portfolio, a product line). Map that layer to parent
projects and leave `parent_id` null otherwise -- an app without one is normal,
not incomplete.

Names are unique and compared case-insensitively, so re-running a sync must
reuse the existing row rather than creating a second: `GET /api/parents`,
match on name, and `POST` only if there is no match. Then
`PUT /api/apps/{{key}}/parent` for each board underneath it.

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

## Importing dates

Only if the tracker has a layer of *shared* dates -- fix versions, sprints,
release trains, a quarter field. A per-ticket due date has nowhere to go here:
milestones are lines several tasks sit above, not a field on a task.

Milestones are per app and matched by `label`, so a re-run must reuse the
existing row: read `milestones` from `GET /api/apps/{{key}}/graph`, match on
label, and `POST` only if there is no match. Then `PATCH /api/nodes/{{id}}`
with `milestone_id` for each ticket in that version.

Two things to know before writing any of it:

- New milestones are **appended**, never sorted into place by date. If the
  tracker's versions have an order worth keeping, create them in that order, or
  `PATCH` `position` afterwards -- it takes an index into the board's run
  (0 is first) and the rest renumber around it.
- A `PATCH` that dates a task is refused if it would put that task before
  something it depends on (see the rule under **Edge** above). Import the
  edges first, then the dates, and treat a refusal as informational: leave that
  task undated and carry on rather than aborting the run. An undated task is a
  normal state, and the refusal is usually telling you the tracker's own dates
  and links disagree.
"""
