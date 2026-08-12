# Agent guide

This project's architectural decisions, gotchas, and conventions live in one
place: **[`CLAUDE.md`](CLAUDE.md)**. Read that first — it covers the
read-only/auth split, why invariants live in the service layer, the
optimistic-mutation flow, the theme/graph-style attribute pair, and the
conventions (status vocabulary, colour tokens, border widths) that are easy to
break without noticing.

It's named `CLAUDE.md` because that's where this project's guidance started;
nothing in it is Claude-specific, and this file exists so a harness looking
for the conventional `AGENTS.md` filename finds its way there too. Update
`CLAUDE.md`, not this file, when something changes — this is a pointer, not a
second copy.

A few other documents worth knowing about up front:

- **[`README.md`](README.md)** — how to get the app running: install,
  configure `.env`, seed data, run tests, deploy.
- **[`docs/API.md`](docs/API.md)** — the full REST reference: every endpoint,
  request/response schema, error shape, and invariant.
- **`GET /api/agent-instructions`** — a generated, runtime-served guide for an
  agent *importing external data into a running board* (e.g. syncing Jira
  tickets in). That's a narrower job than working on this codebase; if that's
  your task, fetch that endpoint instead of reading further here.

## Before you change something

- **Backend**: `cd backend && uv run pytest`. No environment needed — tests
  build their own `Settings` and use a throwaway SQLite file per test.
- **Frontend**: `cd frontend && npx vitest run` for unit tests, `npm run
  build` for the typecheck (there's no separate `tsc --noEmit` script; the
  build *is* the type check).

Both are fast enough to run after every change, not just before a commit.
