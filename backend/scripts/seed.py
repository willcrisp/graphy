"""Populate the database with six apps and realistic feature trees.

    uv run python scripts/seed.py [--reset]

Idempotent on app key: an app that already exists is left alone unless --reset is
passed, which drops every app (cascading to its nodes and edges) first.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select  # noqa: E402

from app.config import ConfigError, load_settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.models import App, Edge, Node  # noqa: E402

# Each app is (key, name, accent, [(local_id, title, status, detail)], [(src, dst)]).
# Local ids are only meaningful inside one app's definition.
SEED: list[tuple[str, str, str, list[tuple[str, str, str, str | None]], list[tuple[str, str]]]] = [
    (
        "atmosphere",
        "Atmosphere",
        "#1F5F8B",
        [
            ("ingest", "Sensor ingest pipeline", "done",
             "Accepts readings from the field units over MQTT and writes them to the "
             "time-series store. Backfill is handled by the same path."),
            ("calib", "Per-unit calibration", "done",
             "Applies the factory offset curve so two units in the same room agree."),
            ("alerts", "Threshold alerts", "wip",
             "Fires when a reading crosses a configured band for longer than the "
             "debounce window. Delivery channels are still email only."),
            ("digest", "Weekly digest email", "todo", None),
            ("anomaly", "Anomaly detection", "todo",
             "Flags readings that break the unit's own recent pattern rather than a "
             "fixed threshold."),
            ("export", "CSV export", "done", None),
            ("mobile", "Mobile push delivery", "blocked",
             "Waiting on the vendor to issue production APNs credentials."),
            ("forecast", "24-hour forecast", "todo",
             "Depends on both the anomaly baseline and a longer calibration history."),
        ],
        [
            ("ingest", "calib"),
            ("ingest", "export"),
            ("calib", "alerts"),
            ("calib", "anomaly"),
            ("alerts", "digest"),
            ("alerts", "mobile"),
            ("anomaly", "forecast"),
            ("calib", "forecast"),
        ],
    ),
    (
        "lattice",
        "Lattice",
        "#5B4B8A",
        [
            # Diamond: schema -> (validate, index) -> query
            ("schema", "Schema registry", "done",
             "One place to register a document shape and version it."),
            ("validate", "Write-time validation", "done",
             "Rejects documents that do not match their registered schema."),
            ("index", "Automatic indexing", "wip",
             "Derives indexes from the registered schema instead of hand-written "
             "definitions."),
            ("query", "Typed query builder", "wip",
             "The diamond closes here: queries are checked against both the "
             "validation rules and the available indexes."),
            ("migrate", "Online migrations", "todo",
             "Rewrite documents to a new schema version without taking writes down."),
            ("replica", "Read replicas", "blocked",
             "Blocked on a decision about the storage tier — see the infra notes."),
            ("console", "Admin console", "todo", None),
        ],
        [
            ("schema", "validate"),
            ("schema", "index"),
            ("validate", "query"),
            ("index", "query"),
            ("query", "migrate"),
            ("query", "console"),
            ("migrate", "replica"),
        ],
    ),
    (
        "ferry",
        "Ferry",
        "#2F6B5E",
        [
            ("connect", "Source connectors", "done",
             "S3, HTTP and Postgres sources, all behind one polling interface."),
            ("transform", "Transform steps", "done", None),
            ("sink", "Sink connectors", "wip",
             "Warehouse sinks are done; the object-store sink still needs its "
             "partitioning story."),
            ("retry", "Retry and dead-letter", "wip",
             "Failed batches land in a queue that can be replayed by hand."),
            ("schedule", "Cron scheduling", "todo", None),
            ("observ", "Run history and metrics", "todo",
             "Per-run timings, row counts, and the failure reason if there was one."),
            ("lineage", "Column-level lineage", "blocked",
             "Needs the transform steps to declare their inputs, which they do not "
             "yet do."),
            ("secrets", "Managed credentials", "done",
             "Connector credentials are stored encrypted rather than in the job "
             "definition."),
        ],
        [
            ("connect", "transform"),
            ("connect", "secrets"),
            ("transform", "sink"),
            ("sink", "retry"),
            ("retry", "schedule"),
            ("schedule", "observ"),
            ("transform", "lineage"),
            ("observ", "lineage"),
        ],
    ),
    (
        "quarry",
        "Quarry",
        "#8A4B2F",
        [
            ("crawl", "Repository crawler", "done",
             "Walks a checkout and records every file it can parse."),
            ("parse", "Language parsers", "wip",
             "Python and TypeScript are solid. Go is partial and Rust has not "
             "started."),
            ("symbols", "Symbol index", "wip", None),
            ("refs", "Cross-reference graph", "todo",
             "Which symbol is used where, across package boundaries."),
            ("search", "Full-text search", "done", None),
            ("api", "Public query API", "todo", None),
            ("dedupe", "Duplicate detection", "blocked",
             "Held until the symbol index stabilises — it would be rewritten twice "
             "otherwise."),
        ],
        [
            ("crawl", "parse"),
            ("crawl", "search"),
            ("parse", "symbols"),
            ("symbols", "refs"),
            ("symbols", "dedupe"),
            ("refs", "api"),
            ("search", "api"),
        ],
    ),
    (
        "beacon",
        "Beacon",
        "#7A5C1E",
        [
            ("probe", "Uptime probes", "done",
             "HTTP and TCP checks from three regions, one minute apart."),
            ("status", "Public status page", "done", None),
            ("incid", "Incident timeline", "wip",
             "Groups related probe failures into a single incident rather than "
             "paging on each one."),
            ("page", "On-call paging", "wip", None),
            ("rota", "Rotation management", "todo",
             "Who is on call this week, and the handover schedule."),
            ("postm", "Post-mortem templates", "todo", None),
            ("sla", "SLA reporting", "blocked",
             "Needs a full quarter of incident data before the numbers mean "
             "anything."),
            ("synth", "Synthetic user journeys", "todo",
             "Scripted multi-step checks, not just a single request."),
            ("maint", "Maintenance windows", "done", None),
        ],
        [
            ("probe", "status"),
            ("probe", "incid"),
            ("probe", "synth"),
            ("maint", "status"),
            ("incid", "page"),
            ("page", "rota"),
            ("incid", "postm"),
            ("postm", "sla"),
            ("rota", "sla"),
        ],
    ),
    # Deliberately empty, to exercise the empty state.
    ("tessellate", "Tessellate", "#6B2F5B", [], []),
]


async def main() -> int:
    reset = "--reset" in sys.argv[1:]
    try:
        settings = load_settings()
    except ConfigError as exc:
        print(f"seed: {exc}", file=sys.stderr)
        return 1

    database = Database(settings.db_url)
    await database.create_all()

    async with database.session() as session:
        if reset:
            await session.execute(delete(App))
            await session.commit()
            print("seed: cleared existing apps")

        for order, (key, name, accent, nodes, edges) in enumerate(SEED):
            existing = await session.scalar(select(App).where(App.key == key))
            if existing is not None:
                print(f"seed: {key} already present, skipping")
                continue

            app = App(key=key, name=name, accent=accent, sort_order=order)
            session.add(app)
            await session.flush()

            ids: dict[str, int] = {}
            for position, (local, title, node_status, detail) in enumerate(nodes):
                node = Node(
                    app_id=app.id,
                    title=title,
                    detail=detail,
                    status=node_status,
                    sort_order=position,
                )
                session.add(node)
                await session.flush()
                ids[local] = node.id

            for source, target in edges:
                session.add(
                    Edge(app_id=app.id, source_id=ids[source], target_id=ids[target])
                )

            await session.commit()
            print(f"seed: {key} - {len(nodes)} nodes, {len(edges)} edges")

    await database.dispose()
    print(f"seed: done ({settings.db_path})")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
