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


class ConfigOut(BaseModel):
    readonly: bool
    authenticated: bool


def _title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Title must not be blank.")
    return cleaned


def _detail(value: str | None) -> str | None:
    return (value.strip() or None) if value is not None else None


class NodeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = Field(default=None, max_length=2000)
    status: Status

    _v_title = field_validator("title")(_title)
    _v_detail = field_validator("detail")(_detail)


class NodeUpdate(BaseModel):
    """PATCH body. Absent fields are left alone; the service reads
    `model_dump(exclude_unset=True)` so an explicit `detail: null` clears it."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    detail: str | None = Field(default=None, max_length=2000)
    status: Status | None = None

    _v_title = field_validator("title")(lambda v: _title(v) if v is not None else None)
    _v_detail = field_validator("detail")(_detail)


class EdgeCreate(BaseModel):
    source_id: int
    target_id: int


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)
