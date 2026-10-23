"""Typed LangGraph state and per-run context shared by every node.

Later nodes extend this file additively: new keys on `State`, new input types for new `Send` targets.
Keys written by parallel nodes need a reducer (`Annotated[list, operator.add]`) so results are appended, not overwritten.
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


class DatasetInfo(TypedDict):
    """What every agent prompt needs about the Chat."""

    question: str
    as_of_date: str  # ISO date, "" when the user gave none; all relative dates resolve against it
    dataset_notes: str | None
    schema_profile: str  # schema_profile.render_for_prompt(...)


class AnalystInput(DatasetInfo):
    """Payload of the `Send` to the SQL Analyst: one independent sub-question."""

    sub_question: str


class AnalystResult(TypedDict):
    sub_question: str
    sql: str
    columns: list[str]
    rows: list[list]


class State(DatasetInfo):
    sub_questions: list[str]  # written by the Orchestrator
    direct_reply: str  # written by the Orchestrator instead of sub_questions: answer now, no analysts or Synthesizer
    results: Annotated[list[AnalystResult], operator.add]  # appended by each SQL Analyst
    charts: Annotated[list[dict], operator.add]  # Chart Specs; appended by the Chart Builder (not built yet)
    answer: str  # written by the Synthesizer
