"""Milestones: the dated lines drawn across a board, and the one invariant
they add -- a task may not depend on work scheduled after it.

The scheduling rule is the interesting half. It is transitive, it treats an
undated task as unconstrained rather than as "last", and it has to hold from
three directions: adding a dependency, dating a task, and moving a line.
"""

from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Milestone, Node
from app.services import graph as service
from app.services.graph import GraphError, NotFoundError
from tests.conftest import make_app, make_edge, make_node


async def make_milestone(
    session: AsyncSession, app, label: str, position: int, due_on: date | None = None
) -> Milestone:
    milestone = Milestone(
        app_id=app.id, label=label, due_on=due_on, position=position
    )
    session.add(milestone)
    await session.commit()
    await session.refresh(milestone)
    return milestone


# --- shape -----------------------------------------------------------------


async def test_milestones_ride_along_with_the_board(
    session: AsyncSession, client: AsyncClient
) -> None:
    app = await make_app(session)
    await make_milestone(session, app, "Q2", 5, date(2026, 6, 30))
    await make_milestone(session, app, "Q1", 1, date(2026, 3, 31))

    body = (await client.get(f"/api/apps/{app.key}/graph")).json()
    labels = [m["label"] for m in body["milestones"]]
    assert labels == ["Q1", "Q2"], "ordered by position, not by insertion"
    assert body["milestones"][0]["due_on"] == "2026-03-31"


async def test_a_task_carries_the_line_it_is_due_by(
    session: AsyncSession, client: AsyncClient
) -> None:
    app = await make_app(session)
    milestone = await make_milestone(session, app, "Q1", 0)
    node = await make_node(session, app, "Ship it")
    node.milestone_id = milestone.id
    await session.commit()

    body = (await client.get(f"/api/apps/{app.key}/graph")).json()
    assert [n["milestone_id"] for n in body["nodes"]] == [milestone.id]


async def test_new_milestones_are_appended_not_sorted_by_date(
    session: AsyncSession,
) -> None:
    """The date is shown, never used to order. A board may want an undated
    'Beta' between two quarters, and a date that disagrees with its neighbours
    should read as a mistake rather than silently re-sort the sheet."""
    app = await make_app(session)
    late = await service.create_milestone(
        session, app, label="Q4", due_on=date(2026, 12, 31)
    )
    early = await service.create_milestone(
        session, app, label="Q1", due_on=date(2026, 3, 31)
    )
    assert late.position < early.position


# --- scheduling ------------------------------------------------------------


async def test_a_dependency_may_not_run_backwards_through_a_line(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    late = await make_node(session, app, "Index rebuild")
    early = await make_node(session, app, "Search UI")
    late.milestone_id = q2.id
    early.milestone_id = q1.id
    await session.commit()

    with pytest.raises(GraphError) as failure:
        await service.create_edge(session, app, source_id=late.id, target_id=early.id)

    message = str(failure.value)
    assert "Search UI" in message and "Index rebuild" in message
    assert "Q1" in message and "Q2" in message


async def test_a_dependency_forwards_through_a_line_is_fine(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    early = await make_node(session, app, "Schema")
    late = await make_node(session, app, "Migration")
    early.milestone_id = q1.id
    late.milestone_id = q2.id
    await session.commit()

    edge = await service.create_edge(session, app, source_id=early.id, target_id=late.id)
    assert edge.id is not None


async def test_two_tasks_on_the_same_line_may_depend_on_each_other(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    first = await make_node(session, app, "First")
    second = await make_node(session, app, "Second")
    first.milestone_id = q1.id
    second.milestone_id = q1.id
    await session.commit()

    edge = await service.create_edge(
        session, app, source_id=first.id, target_id=second.id
    )
    assert edge.id is not None


async def test_an_undated_task_is_unconstrained(session: AsyncSession) -> None:
    """Adding a first milestone to a board full of undated work must not
    invalidate any of it -- adoption is meant to be incremental."""
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    late = await make_node(session, app, "Late")
    late.milestone_id = q2.id
    early = await make_node(session, app, "Early")
    early.milestone_id = q1.id
    after = await make_node(session, app, "Floats after")
    before = await make_node(session, app, "Floats before")
    await session.commit()

    # An undated task sits happily on either side of either line: it is not
    # treated as "sometime at the end", it simply has no opinion.
    await service.create_edge(session, app, source_id=late.id, target_id=after.id)
    await service.create_edge(session, app, source_id=before.id, target_id=early.id)
    await service.create_edge(session, app, source_id=early.id, target_id=late.id)


async def test_the_rule_is_transitive_through_undated_work(
    session: AsyncSession,
) -> None:
    """An undated task carries whatever it inherits even though it never fails
    on its own account, so a chain through one is still caught -- and the
    message names the two dated ends, not the innocent task in the middle."""
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    late = await make_node(session, app, "Late thing")
    middle = await make_node(session, app, "Middle")
    early = await make_node(session, app, "Early thing")
    late.milestone_id = q2.id
    early.milestone_id = q1.id
    await session.commit()

    await service.create_edge(session, app, source_id=late.id, target_id=middle.id)
    with pytest.raises(GraphError) as failure:
        await service.create_edge(
            session, app, source_id=middle.id, target_id=early.id
        )
    message = str(failure.value)
    assert "Late thing" in message and "Early thing" in message
    assert "Middle" not in message


async def test_the_message_names_the_nearest_culprit_among_equals(
    session: AsyncSession,
) -> None:
    """Two Q2 tasks upstream of a Q1 one are both true answers; the useful one
    is whichever is closest, which is normally the edge just drawn."""
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    far = await make_node(session, app, "Far")
    near = await make_node(session, app, "Near")
    early = await make_node(session, app, "Early")
    far.milestone_id = q2.id
    near.milestone_id = q2.id
    early.milestone_id = q1.id
    await session.commit()
    await make_edge(session, app, far, near)

    with pytest.raises(GraphError) as failure:
        await service.create_edge(session, app, source_id=near.id, target_id=early.id)
    assert "Near" in str(failure.value)
    assert "Far" not in str(failure.value)


async def test_dating_a_task_is_checked_against_its_dependencies(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    blocker = await make_node(session, app, "Blocker")
    dependent = await make_node(session, app, "Dependent")
    blocker.milestone_id = q2.id
    await session.commit()
    await make_edge(session, app, blocker, dependent)

    with pytest.raises(GraphError):
        await service.update_node(session, dependent.id, {"milestone_id": q1.id})

    # The later line is fine, and so is taking it off the calendar entirely.
    await service.update_node(session, dependent.id, {"milestone_id": q2.id})
    await service.update_node(session, dependent.id, {"milestone_id": None})


async def test_moving_a_line_past_another_is_checked(session: AsyncSession) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    early = await make_node(session, app, "Early")
    late = await make_node(session, app, "Late")
    early.milestone_id = q1.id
    late.milestone_id = q2.id
    await session.commit()
    await make_edge(session, app, early, late)

    # Dragging Q2 above Q1 would put the dependency's target before its source.
    with pytest.raises(GraphError):
        await service.update_milestone(session, q2.id, {"position": 0})

    # And the board is untouched by the refusal.
    assert [m.label for m in await service.list_milestones(session, app.id)] == [
        "Q1",
        "Q2",
    ]


async def test_a_task_cannot_be_dated_by_another_boards_line(
    session: AsyncSession,
) -> None:
    mine = await make_app(session, key="mine")
    theirs = await make_app(session, key="theirs")
    elsewhere = await make_milestone(session, theirs, "Q1", 0)
    node = await make_node(session, mine, "Task")

    with pytest.raises(GraphError, match="different app"):
        await service.update_node(session, node.id, {"milestone_id": elsewhere.id})


async def test_an_unknown_milestone_is_a_404_not_a_dangling_reference(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    node = await make_node(session, app, "Task")
    with pytest.raises(NotFoundError):
        await service.update_node(session, node.id, {"milestone_id": 9999})


# --- reordering and deletion ------------------------------------------------


async def test_moving_a_line_renumbers_the_run_from_zero(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    await make_milestone(session, app, "A", 3)
    await make_milestone(session, app, "B", 7)
    third = await make_milestone(session, app, "C", 11)

    await service.update_milestone(session, third.id, {"position": 0})
    ordered = await service.list_milestones(session, app.id)
    assert [(m.label, m.position) for m in ordered] == [("C", 0), ("A", 1), ("B", 2)]


async def test_a_position_past_the_end_lands_last(session: AsyncSession) -> None:
    app = await make_app(session)
    first = await make_milestone(session, app, "A", 0)
    await make_milestone(session, app, "B", 1)

    await service.update_milestone(session, first.id, {"position": 99})
    assert [m.label for m in await service.list_milestones(session, app.id)] == [
        "B",
        "A",
    ]


async def test_deleting_a_line_undates_its_work_but_keeps_it(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    milestone = await make_milestone(session, app, "Q1", 0)
    node = await make_node(session, app, "Ship it")
    node.milestone_id = milestone.id
    await session.commit()

    await service.delete_milestone(session, milestone.id)

    survivor = await session.get(Node, node.id)
    assert survivor is not None
    assert survivor.milestone_id is None
    assert await service.list_milestones(session, app.id) == []


async def test_deleting_the_app_takes_its_milestones_with_it(
    session: AsyncSession,
) -> None:
    app = await make_app(session)
    await make_app(session, key="survivor")
    await make_milestone(session, app, "Q1", 0)

    await service.delete_app(session, app.key)
    assert await service.list_milestones(session, app.id) == []


# --- API surface ------------------------------------------------------------


async def test_milestone_endpoints_answer_with_the_whole_board(
    session: AsyncSession, admin: AsyncClient
) -> None:
    app = await make_app(session)

    created = await admin.post(
        f"/api/apps/{app.key}/milestones",
        json={"label": "Q1 2026", "due_on": "2026-03-31"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["milestone"]["label"] == "Q1 2026"
    assert [m["label"] for m in body["graph"]["milestones"]] == ["Q1 2026"]
    assert "apps" in body

    milestone_id = body["milestone"]["id"]
    patched = await admin.patch(
        f"/api/milestones/{milestone_id}", json={"due_on": None, "label": "Beta"}
    )
    assert patched.status_code == 200, patched.text
    updated = patched.json()["milestone"]
    assert updated["label"] == "Beta"
    # An explicit null clears the date rather than being read as "not supplied".
    assert updated["due_on"] is None

    removed = await admin.delete(f"/api/milestones/{milestone_id}")
    assert removed.status_code == 200
    assert removed.json()["graph"]["milestones"] == []


# Both auth layers are covered by `MUTATIONS` in test_auth.py, which the three
# milestone endpoints are listed in -- they inherit the router's guards rather
# than declaring their own, so that table is where they belong.


async def test_a_backwards_dependency_is_a_422_with_a_sentence(
    session: AsyncSession, admin: AsyncClient
) -> None:
    app = await make_app(session)
    q1 = await make_milestone(session, app, "Q1", 0)
    q2 = await make_milestone(session, app, "Q2", 1)
    late = await make_node(session, app, "Index rebuild")
    early = await make_node(session, app, "Search UI")
    late.milestone_id = q2.id
    early.milestone_id = q1.id
    await session.commit()

    response = await admin.post(
        f"/api/apps/{app.key}/edges",
        json={"source_id": late.id, "target_id": early.id},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail.endswith("Nothing can depend on work scheduled after it.")
