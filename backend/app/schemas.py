"""Pydantic request/response models.

`Status` is a Literal so an invalid status is rejected at the API boundary with a
422 before it ever reaches the CHECK constraint in the database.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
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
    #: The parent project this board hangs off, or null for a standalone board.
    #: Only the overview canvas draws anything with it; a board's own page is
    #: unchanged by it.
    parent_id: int | None
    sort_order: int


class AppSummary(AppOut):
    counts: StatusCounts


class ParentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    detail: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime

    _v_created = field_validator("created_at")(_as_utc)
    _v_updated = field_validator("updated_at")(_as_utc)


class MilestoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: int
    label: str
    #: Plain calendar date, no time and no zone: a milestone is a day on a
    #: roadmap, not an instant. Serialises as "2026-03-31".
    due_on: date | None
    #: The sole ordering key, low to high. See `models.Milestone` for why the
    #: date deliberately does not sort these.
    position: int
    created_at: datetime
    updated_at: datetime

    _v_created = field_validator("created_at")(_as_utc)
    _v_updated = field_validator("updated_at")(_as_utc)


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: int
    title: str
    detail: str | None
    status: Status
    external_ref: str | None
    #: The milestone this task is due by, or null for "no date committed".
    #: A null one is unconstrained: the canvas lays it out wherever its
    #: dependencies put it, above or below any rule.
    milestone_id: int | None
    is_root: bool
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
    #: This board's dated lines, in `position` order. Board-only: `OverviewOut`
    #: has no equivalent, because a rule drawn across every board at once would
    #: cut through five other boards' work (see `canvas.ts`).
    milestones: list[MilestoneOut]
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


class MilestoneMutationOut(BoardOut):
    """A board plus the milestone just written.

    A board, not an overview: a milestone belongs to one app and only re-shapes
    that app's sheet, so the ordinary `runMutation` patch-then-reconcile applies
    exactly as it does to a task.
    """

    milestone: MilestoneOut


class OverviewOut(BaseModel):
    """Every board at once: what the overview canvas draws.

    The same idea as `BoardOut` one level up. Where a board is one app's nodes
    and edges, this is *all* of them, plus the parent projects that join them.
    Nodes and edges carry `app_id`, so the client can tell the clusters apart
    without a per-app envelope.

    Nothing here is grouped or nested. The canvas lays every node out in one
    dagre pass and the joins between boards are computed from `parent_id`, so
    a flat list is exactly what it wants.
    """

    parents: list[ParentOut]
    apps: list[AppSummary]
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    last_updated: datetime | None

    _v_last_updated = field_validator("last_updated")(_as_utc)


class ParentMutationOut(OverviewOut):
    """An overview plus the parent project just written, so it can be selected.

    Parent mutations answer with the whole overview for the same reason app
    mutations answer with the whole tab strip: attaching, detaching or deleting
    a parent re-shapes which boards join to what, which is not a patch to one
    board but a change to the structure between all of them.
    """

    parent: ParentOut


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
    milestone_id: int | None = None

    _v_title = field_validator("title")(_title)
    _v_detail = field_validator("detail")(_detail)
    _v_external_ref = field_validator("external_ref")(_detail)


class NodeUpdate(BaseModel):
    """PATCH body. Absent fields are left alone; the service reads
    `model_dump(exclude_unset=True)` so an explicit `detail: null` clears it --
    and an explicit `milestone_id: null` takes the task off the calendar."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    detail: str | None = Field(default=None, max_length=2000)
    status: Status | None = None
    external_ref: str | None = Field(default=None, max_length=200)
    milestone_id: int | None = None

    _v_title = field_validator("title")(lambda v: _title(v) if v is not None else None)
    _v_detail = field_validator("detail")(_detail)
    _v_external_ref = field_validator("external_ref")(_detail)


class MilestoneCreate(BaseModel):
    label: str = Field(min_length=1, max_length=64)
    due_on: date | None = None

    _v_label = field_validator("label")(_name)


class MilestoneUpdate(BaseModel):
    """PATCH body, same convention as `NodeUpdate`. An explicit `due_on: null`
    clears the date; `position` moves the rule up or down the sheet and the
    service renumbers the rest of the run around it."""

    label: str | None = Field(default=None, min_length=1, max_length=64)
    due_on: date | None = None
    position: int | None = Field(default=None, ge=0)

    _v_label = field_validator("label")(lambda v: _name(v) if v is not None else None)


class AppCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    accent: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")

    _v_name = field_validator("name")(_name)


class AppUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    _v_name = field_validator("name")(_name)


class ParentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    detail: str | None = Field(default=None, max_length=2000)

    _v_name = field_validator("name")(_name)
    _v_detail = field_validator("detail")(_detail)


class ParentUpdate(BaseModel):
    """PATCH body, same convention as `NodeUpdate`: absent fields are left
    alone, an explicit `detail: null` clears the description."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    detail: str | None = Field(default=None, max_length=2000)

    _v_name = field_validator("name")(lambda v: _name(v) if v is not None else None)
    _v_detail = field_validator("detail")(_detail)


class AppParentUpdate(BaseModel):
    """Which parent project a board hangs off. `null` detaches it.

    Its own endpoint rather than a field on `AppUpdate`, because that body's
    `name` is required -- folding an optional field into it would make every
    rename able to silently re-parent a board.
    """

    parent_id: int | None


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
