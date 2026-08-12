"""Pydantic request/response models.

`Status` is a Literal so an invalid status is rejected at the API boundary with a
422 before it ever reaches the CHECK constraint in the database.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Status = Literal["done", "wip", "todo", "blocked"]


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite has no timezone type, so values come back naive. They were written
    as UTC; say so explicitly, or the browser reads them as local time."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


class StatusCounts(BaseModel):
    done: int = 0
    wip: int = 0
    todo: int = 0
    blocked: int = 0


class AppOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    accent: str
    sort_order: int


class AppSummary(AppOut):
    counts: StatusCounts


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: int
    title: str
    detail: str | None
    status: Status
    external_ref: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime

    _v_created = field_validator("created_at")(_as_utc)
    _v_updated = field_validator("updated_at")(_as_utc)


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: int
    source_id: int
    target_id: int


class GraphOut(BaseModel):
    app: AppOut
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    last_updated: datetime | None

    _v_last_updated = field_validator("last_updated")(_as_utc)


class BoardOut(BaseModel):
    """Everything a mutation invalidates, returned by the mutation itself.

    The client used to fire the mutation and then re-fetch `/graph` and `/apps`,
    two serial round trips before anything could be redrawn. Mutating endpoints
    return this instead so one trip is enough. `apps` rides along because the
    per-app status counts in the title block change whenever a node does.
    """

    graph: GraphOut
    apps: list[AppSummary]


class NodeMutationOut(BoardOut):
    """A board plus the node the caller just wrote, so it can be selected."""

    node: NodeOut


class EdgeMutationOut(BoardOut):
    edge: EdgeOut


class ConfigOut(BaseModel):
    readonly: bool
    authenticated: bool


def _title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Title must not be blank.")
    return cleaned


def _name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Name must not be blank.")
    return cleaned


def _detail(value: str | None) -> str | None:
    return (value.strip() or None) if value is not None else None


class NodeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = Field(default=None, max_length=2000)
    status: Status
    external_ref: str | None = Field(default=None, max_length=200)

    _v_title = field_validator("title")(_title)
    _v_detail = field_validator("detail")(_detail)
    _v_external_ref = field_validator("external_ref")(_detail)


class NodeUpdate(BaseModel):
    """PATCH body. Absent fields are left alone; the service reads
    `model_dump(exclude_unset=True)` so an explicit `detail: null` clears it."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    detail: str | None = Field(default=None, max_length=2000)
    status: Status | None = None
    external_ref: str | None = Field(default=None, max_length=200)

    _v_title = field_validator("title")(lambda v: _title(v) if v is not None else None)
    _v_detail = field_validator("detail")(_detail)
    _v_external_ref = field_validator("external_ref")(_detail)


class AppCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    accent: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    _v_name = field_validator("name")(_name)


class AppUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    _v_name = field_validator("name")(_name)


class AppsOut(BaseModel):
    """Every app with its counts. What the tab strip needs after an app-level
    mutation -- unlike a node change, the active board may no longer exist."""

    apps: list[AppSummary]


class AppMutationOut(AppsOut):
    """Apps plus the one just written, so the client can select it."""

    app: AppOut


class EdgeCreate(BaseModel):
    source_id: int
    target_id: int


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)
