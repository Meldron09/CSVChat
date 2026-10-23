"""Typed LangGraph state and per-run context shared by every node.

Later nodes extend this file additively: new keys on `State`, new input types for new `Send` targets.
Keys written by parallel nodes need a reducer (`Annotated[list, add_or_reset]`) so results are appended, not overwritten.

The graph runs with the Postgres checkpointer, one thread per Chat, so `State` outlives a turn. Only `turns` is meant
to persist (the transcript, appended by the `record_turn` node); every other key is per-turn and `turn_input` resets it
at the start of each run, so a finished or failed turn never leaks into the next.
"""

import operator
import uuid
from dataclasses import dataclass
from typing import Annotated, TypedDict

from langchain_core.language_models import BaseChatModel

from app.settings import Settings


@dataclass(frozen=True)
class Context:
    """Per-run, read-only dependencies (LangGraph `context=`); nodes read them from `runtime.context`."""

    settings: Settings
    model: BaseChatModel  # from app.state.model_factory(settings): the single model construction point
    chat_id: uuid.UUID


HISTORY_TURNS = 6  # how many previous turns reach the model (question, SQL run, answer text); older ones stay in the transcript only


def add_or_reset(old: list | None, new: list | None) -> list:
    """Reducer for per-turn lists written by parallel nodes: append, except `None`, which `turn_input` sends to clear it."""
    return [] if new is None else (old or []) + new


class Turn(TypedDict):
    """One finished turn of the transcript. Chart Specs live here (so a reload redraws them) but never go to the model."""

    question: str
    as_of_date: str
    queries: list[dict]  # per SQL Analyst: {task, sub_question, sql, error}
    answer: str
    charts: list[dict]


class DatasetInfo(TypedDict):
    """What every agent prompt needs about the Chat."""

    question: str
    as_of_date: str  # ISO date, "" when the user gave none; all relative dates resolve against it
    dataset_notes: str | None
    schema_profile: str  # schema_profile.render_for_prompt(...)
    history: str  # the last HISTORY_TURNS turns rendered for prompts, set by the Orchestrator; "" for a first question


class AnalystInput(DatasetInfo):
    """Payload of the `Send` to the SQL Analyst: one independent sub-question."""

    task: int  # 0-based position of the sub-question in the plan; tags this analyst's events and result
    sub_question: str


class AnalystResult(TypedDict):
    task: int
    sub_question: str
    sql: str
    columns: list[str]
    rows: list[list]
    truncated: bool  # only the first 1,000 rows were kept
    error: str | None  # set when the query could not be made to work; `sql` is then the last attempt, no rows


class State(DatasetInfo):
    turns: Annotated[list[Turn], operator.add]  # the transcript: persists across runs, appended by `record_turn`
    # Everything below is per-turn and reset by `turn_input`.
    sub_questions: list[str]  # written by the Orchestrator
    direct_reply: str  # written by the Orchestrator instead of sub_questions: answer now, no analysts or Synthesizer
    results: Annotated[list[AnalystResult], add_or_reset]  # appended by each SQL Analyst
    charts: Annotated[list[dict], add_or_reset]  # validated Chart Specs (app/chart_spec.py), from the Chart Builder
    chart_notes: list[str]  # what the Chart Builder rejected or dropped; the Synthesizer must not claim those charts
    answer: str  # written by the Synthesizer


def turn_input(question: str, as_of_date: str, dataset_notes: str | None, schema_profile: str) -> dict:
    """Graph input for a new turn: the question plus a reset of every per-turn key left by earlier (or failed) turns."""
    return {
        "question": question,
        "as_of_date": as_of_date,
        "dataset_notes": dataset_notes,
        "schema_profile": schema_profile,
        "history": "",
        "sub_questions": [],
        "direct_reply": "",
        "results": None,
        "charts": None,
        "chart_notes": [],
        "answer": "",
    }
