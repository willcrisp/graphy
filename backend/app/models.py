"""SQLAlchemy models. Five tables, kept deliberately small."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

STATUSES = ("done", "wip", "todo", "blocked")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Parent(Base):
    """A parent project: the one thing that sits above an app.

    It holds a name and a description and nothing else -- no status, no tasks,
    no edges of its own. Several apps point at the same row, which is the whole
    point: it is where the overview canvas joins otherwise-independent boards
    together. Apps are not required to have one.

    Deliberately flat: a parent has no parent. One level is what the overview
    draws, and nesting would need a cycle check for a hierarchy nobody asked
    for.
    """

    __tablename__ = "parent"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Unique so two parent projects can never be told apart only by their id.
    # `services/graph.py` checks case-insensitively first so the refusal reads
    # as a sentence; this constraint is the backstop under it.
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    apps: Mapped[list[App]] = relationship(back_populates="parent")


class App(Base):
    __tablename__ = "app"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    accent: Mapped[str] = mapped_column(String(7), nullable=False)
    # Optional, and SET NULL rather than CASCADE on purpose: deleting a parent
    # project detaches the boards under it, it does not destroy them. A board
    # is the expensive thing here; the grouping above it is not.
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("parent.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    parent: Mapped[Parent | None] = relationship(back_populates="apps")
    nodes: Mapped[list[Node]] = relationship(
        back_populates="app", cascade="all, delete-orphan", passive_deletes=True
    )
    edges: Mapped[list[Edge]] = relationship(
        back_populates="app", cascade="all, delete-orphan", passive_deletes=True
    )


class Node(Base):
    __tablename__ = "node"
    __table_args__ = (
        CheckConstraint(
            "status IN ('done', 'wip', 'todo', 'blocked')", name="ck_node_status"
        ),
        # NULLs are exempt from SQLite uniqueness, so this only bites nodes
        # that actually carry an external_ref -- most hand-created ones don't.
        UniqueConstraint("app_id", "external_ref", name="uq_node_app_external_ref"),
        # Partial index: only rows with is_root=1 participate, so this enforces
        # "at most one root per app" without constraining ordinary nodes at all.
        Index("uq_node_app_root", "app_id", unique=True, sqlite_where=text("is_root")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    app_id: Mapped[int] = mapped_column(
        ForeignKey("app.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # An opaque handle to whatever created this node from an external system,
    # e.g. a Jira key like "PROJ-123". Unique per app so a re-run of an import
    # can look a node up by it instead of guessing from the title. Never
    # interpreted by this app -- no format is assumed or validated.
    external_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # One per app, created alongside it and never through the ordinary node
    # endpoints (NodeCreate has no such field). Represents the app itself as
    # the single top-level ancestor of the graph; see services/graph.py.
    is_root: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    app: Mapped[App] = relationship(back_populates="nodes")


class Edge(Base):
    __tablename__ = "edge"
    __table_args__ = (
        UniqueConstraint("source_id", "target_id", name="uq_edge_source_target"),
        CheckConstraint("source_id != target_id", name="ck_edge_not_self"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    app_id: Mapped[int] = mapped_column(
        ForeignKey("app.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[int] = mapped_column(
        ForeignKey("node.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[int] = mapped_column(
        ForeignKey("node.id", ondelete="CASCADE"), nullable=False, index=True
    )

    app: Mapped[App] = relationship(back_populates="edges")


class Meta(Base):
    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
