# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For the full REST endpoint/schema reference, see [`docs/API.md`](docs/API.md) rather
than duplicating it here. Non-Claude tooling that looks for `AGENTS.md` finds a
pointer back to this file at [`AGENTS.md`](AGENTS.md).

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
rendered directly in the detail panel — the cycle message names both tasks by
title. Write new ones as sentences a person reads, not as error codes.

### Agent import: `external_ref` and `/api/agent-instructions`

`Node.external_ref` exists for one purpose: letting an external importer (an
agent syncing Jira tickets, say) recognise a node it already created, instead
of duplicating it or matching fuzzily on title. It is opaque to this app —
never parsed, never rendered as a link — and unique per app (not globally;
`uq_node_app_external_ref` in `models.py`), enforced in `services/graph.py`
*and* at the DB layer so an IntegrityError can never surface as a raw 500. The
frontend only ever displays it (in the panel header); nothing in the UI writes
it, and `optimistic.draftNode` always sets it to `null`.

`GET /api/agent-instructions` (in `public.py`, no auth) serves a generated
Markdown guide for that importer — endpoints, auth, the edge/cycle rules, and
the reuse-by-`external_ref` workflow. It's generated rather than hand-written
prose because the status vocabulary it lists is pulled from `models.STATUSES`
— see `instructions.py`. Don't hardcode `done`/`wip`/`todo`/`blocked` there;
that would make it a fourth place that list has to stay in sync (see
"Conventions that will bite you" below).

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
in `nodeHeight()` and never measured from the DOM. `.task { height: 100% }` in
`app.css` makes the drawn node fill whatever box `layout.ts` reserved, so small drift
between the arithmetic and the real type metrics can't cause clipping. If you change
node padding, font size, or line height, re-check the constants at the top of
`layout.ts`.

Nodes are fed to dagre in `sort_order`-then-`id` order and edges in `id` order,
because dagre's output depends on insertion order and layout stability across
reloads is a tested requirement.

### The theme is one attribute on `<html>`

`data-theme` is `light` or `dark`, never absent. It is written twice: by the inline
script in `frontend/index.html` **before first paint** (so a dark visitor never sees
the light board flash), and thereafter by `applyTheme` in `theme.ts`. Because the
attribute is always explicit, `tokens.css` has a single `:root[data-theme='dark']`
block rather than a copy of it under `prefers-color-scheme`.

`resolveTheme(stored, prefersDark)` is the only rule — an explicit choice beats the
OS, anything else follows the OS — and it is pure so `theme.test.ts` can cover it
without a DOM. The storage key `blueprint.theme` is duplicated as a literal in
`index.html`, because that script has to run before any module loads. Change both.

Only colour changes between themes. Every rule weight, size and space is shared,
because status is carried by the drawing convention (hairline vs heavy, dashed for
`wip`), not by fill.

### Graph style is a second, independent attribute

`data-graph-style` (`blueprint` or `neptune`, set by `graphStyle.ts`) is unrelated to
`data-theme` — either graph style combines with either theme. Unlike the theme, it
only reskins `.canvas`: the topbar, panel and dialogs never look at it. `useGraphStyle`
shares its localStorage-backed wiring with `useTheme` through
`persistedChoice.ts`'s `usePersistedChoice` — each still keeps its own pure resolver
(`resolveGraphStyle`/`resolveTheme`, independently tested) and its own `apply`
function, because the fallback rule genuinely differs: theme falls back to the OS
preference, graph style has no such thing. There's no pre-paint script in
`index.html` for graph style — `.canvas` doesn't exist until the board has finished
loading, so there's nothing to flash.

Neptune is a vertical, more expansive layout with borderless glyph-and-label nodes
instead of bordered cards, flowing bezier edges with arrowheads instead of blueprint's
right-angle steps, and a fixed near-black canvas ground that does **not** vary with
the light/dark theme — that ground is the one trait that defines the look. `layout.ts`'s
`layoutGraph` takes the style as a
third argument and branches dagre's `rankdir`/spacing and the per-node dimensions
(`neptuneNodeWidth` hugs the label; blueprint's `nodeHeight` wraps a fixed card
width). Rank is read off whichever axis dagre actually ranks on for that direction —
x for `LR`, y for `TB` — which is also why `TaskNode`'s `Handle`s move from
left/right to top/bottom under Neptune: React Flow anchors edge paths to them, so
that one placement decision can't be done in CSS.

Everything else — hiding the card border and detail paragraph, collapsing the status
word down to just its glyph, recolouring by status — is a plain CSS override under
`[data-graph-style='neptune']`, deliberately kept out of `TaskNode.tsx` the same way
`data-theme` never touches component logic. The one trap: `color` is a regular
property, not a custom one, so an element under `.canvas` that never redeclares it
(the title block's date/sheet values, its task count) inherits the *computed* colour
from `body` — the outer theme's ink, not this scope's override — unless something
between them redeclares `color: var(--ink)`. That redeclaration lives right next to
Neptune's token overrides in `tokens.css`; if new canvas-scoped tokens stop showing
up, this is the first thing to check.

Every Neptune edge is solid by default; the one exception is deliberate signal, not
decoration. `Graph.tsx` sets React Flow's `animated` on an edge exactly when its
*target* is `wip` — done-into-wip or todo-into-wip both qualify, the source status is
irrelevant — and app.css recolours and redashes only `.react-flow__edge.animated`
paths (`--st-wip`, a tighter dash) while leaving the crawling motion itself to React
Flow's own `.animated` keyframe in its stylesheet, so the two can't drift apart. An
edge whose target is done, todo or blocked always renders solid regardless of style.

### Every mutation is applied twice: locally, then from the response

`runMutation` in `App.tsx` patches the graph optimistically so the board redraws on
the click, fires the request, and then replaces the graph outright with what comes
back. On failure it restores the snapshot it took first.

This costs one round trip, not two: **every mutating endpoint returns the whole
board** — `{graph, apps}`, plus the row it wrote — so there is nothing left to
re-fetch. `apps` rides along because the title-block counts move whenever a node
does. That is why none of the deletes are 204.

The local half lives in `frontend/src/optimistic.ts`, deliberately pure and
separately tested. **Those functions must mirror `services/graph.py`, not guess at
it** — deleting a node cascades its edges and does not reparent its children, and a
divergence shows up as the board visibly changing twice, once on the click and again
on reconcile.

Rows that exist only on the client carry a **negative id** (`tempId()`). Real ids are
SQLite rowids and always positive, so a temp id that leaks to the API gets an obvious
404 rather than silently editing row 1. Selection follows a temp id to its real one
in `onReconciled`, in the same batch as the reconcile, or the panel blanks for a
frame.

Rollback is not an edge case here. Rejecting a cycle or a duplicate connection is a
normal outcome, so those edges have to appear on the click and then disappear with
the server's sentence. Only the newest in-flight mutation may roll back — an older
one restoring its snapshot would undo a newer pending patch.

App-level mutations (create/rename/delete app) deliberately bypass all of this: they
create and destroy whole boards, so there is no single board to patch or roll back.

### Shared primitives — reuse these instead of copying a shape

A few pieces of behaviour recur across otherwise-unrelated features. Each was
factored out once; adding a fourth caller that reimplements one is the bug to
avoid.

- **`components/Modal.tsx`** — the scrim-plus-Escape-plus-click-outside
  dismissal shared by `SignIn` and `AppDialog`. A new modal wraps its content
  in this rather than reimplementing the backdrop handlers.
- **`components/ToggleGroup.tsx`** — the `role="group"` row of
  `aria-pressed` buttons behind `ModeToggle` (view/edit) and
  `GraphStyleToggle` (blueprint/neptune). Both are two-way today; the
  component itself is not limited to two options.
- **`persistedChoice.ts`**'s `usePersistedChoice` — the localStorage-seed,
  apply-on-change, persist-on-choose wiring behind `useTheme` and
  `useGraphStyle` (see "Graph style is a second, independent attribute"
  above). It returns the raw setter alongside the persisting one because
  `useTheme` needs to track the OS preference *without* writing it to
  storage — following the system is not an explicit choice.
- **`totalOf(counts)`** in `types.ts` — sums a `StatusCounts`. Used by the
  tab strip, the delete-app confirmation, and the title block; summing the
  four fields by hand anywhere is a sign a fifth status will silently be
  missed there someday.
- **`routers/admin.py`**'s `_app_mutation` / `_node_mutation` /
  `_edge_mutation` — every mutating handler writes one row via
  `services/graph.py`, then wraps it with a freshly-read `BoardOut` (see
  "Every mutation is applied twice" below for why the whole board comes
  back). These three functions are that second half, factored out so a new
  handler is just "call the service, then wrap the result."

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

In dark the four drawing colours are re-picked (the light ones sit as low as 1.6:1
on the dark ground) and all four clear 4.5:1 as drawn, so there the `-ink` tokens are
aliases of the drawing colours. Keep painting text with `-ink` regardless — callers
must not have to know which theme is up. If you retune any status hue, re-check it
against **both** `--ground` and `--surface` in **both** themes.

**Never paint with `--accent` or `--tab-accent` directly — use `--accent-draw` /
`--tab-accent-draw`.** The accent is one stored hex per app, chosen against the light
ground and injected as an inline custom property; the drawn tokens mix it toward
white in dark. They are re-derived on `:root`, `.canvas` and `.tab` separately
because `var()` substitution happens where the declaration sits, so a single
derivation at `:root` would freeze every descendant to the root's accent.

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

Required: `ROADMAP_SECRET_KEY`, `ROADMAP_ADMIN_PASSWORD` (plaintext; the `.env`
file is the trust boundary). The app refuses to start without them and names the missing one — it
never generates a fallback secret. Optional: `ROADMAP_DB_PATH`, `ROADMAP_READONLY`,
`ROADMAP_SECURE_COOKIES`, `ROADMAP_STATIC_DIR`. All documented in `.env.example`.

Set `ROADMAP_STATIC_DIR` to `frontend/dist` for production single-port serving; leave
it unset in development so the Vite proxy handles `/api`.

Uvicorn reads `--env-file` **once, at process start**. Editing `.env` and relying
on `--reload` does nothing — reload re-imports code, not the environment. Restart
the backend after any `.env` change. `scripts/dev.ps1` frees ports 8000 and 5173
before binding them, so `just run dev` is always a real restart; without that a
survivor of a missed Ctrl+C keeps the port and the new process exits silently.

**On Windows, do not write `.env` with PowerShell's `Set-Content -Encoding utf8`** —
it emits a BOM that `python-dotenv` parses into the *name* of the first variable, so
the app reports that variable as missing.

## Tests

`tests/conftest.py`: the `session` and `client` fixtures point at the **same** tmp
SQLite file, so you can seed through `session` and read the result through `client`
in one test. Helpers `make_app`, `make_node`, `make_edge` insert directly; the `admin`
fixture returns a client carrying a valid session cookie.
