"""Engine, session factory, and the foreign-key pragma.

SQLite ships with foreign key enforcement OFF. Without the pragma below every
`ON DELETE CASCADE` in models.py silently does nothing, so it is applied to every
connection as it is checked out of the pool rather than once at startup.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base

SCHEMA_VERSION = "2"

#: Columns added to an existing table after that table first shipped.
#: `create_all` creates missing *tables* but never alters an existing one, so a
#: database written before the column existed would keep failing on every read.
#: This is not a migration framework and is not meant to grow into one -- there
#: is no down direction, no ordering, and no version gate. It is the additive
#: case only: a nullable column with no default, safe to apply to any row.
#: Anything that needs more than that (a rename, a backfill, a NOT NULL) is a
#: rebuild, and the honest answer there is `seed.py --reset`.
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # Schema 2: parent projects.
    ("app", "parent_id", "INTEGER REFERENCES parent(id) ON DELETE SET NULL"),
)


class Database:
    def __init__(self, url: str) -> None:
        self.engine = create_async_engine(url, future=True)
        self._sessions = async_sessionmaker(
            self.engine, expire_on_commit=False, class_=AsyncSession
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record) -> None:  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self._sessions() as session:
            yield session

    async def create_all(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            for table, column, definition in _ADDED_COLUMNS:
                present = {
                    row[1]
                    for row in await connection.execute(
                        text(f"PRAGMA table_info({table})")
                    )
                }
                # A fresh database already has the column -- create_all built
                # the table from the current model. Only an older file needs it.
                if column not in present:
                    await connection.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    )
            await connection.execute(
                text(
                    "INSERT INTO meta (key, value) VALUES ('schema_version', :v) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                ),
                {"v": SCHEMA_VERSION},
            )

    async def dispose(self) -> None:
        await self.engine.dispose()
