"""SQLAlchemy models. Four tables, kept deliberately small."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

STATUSES = ("done", "wip", "todo", "blocked")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class App(Base):
    __tablename__ = "app"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    accent: Mapped[str] = mapped_column(String(7), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
