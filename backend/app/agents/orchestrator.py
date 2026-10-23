"""Orchestrator: turns the question into independent sub-questions for the SQL Analysts."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

from app import schema_profile
from app.agents.common import call_structured, dataset_context
from app.events import emit
from app.state import Context, State

SYSTEM = """You are the Orchestrator of a data analysis assistant. The user asks a question about their uploaded CSV Tables.
Rewrite it as ONE self-contained sub-question a SQL analyst can answer with a single query.
Resolve relative dates against the As-of Date and write the resulting absolute dates into the sub-question.
Keep any business definitions from the Dataset Notes that apply (for example how Revenue is defined).

If the question cannot be answered from the Tables in the Schema Profile (the data it needs is not there, or it is unrelated to the data), do not invent an answer: leave sub_questions empty and set direct_reply to a short, plain statement that this can't be answered from this data, saying what is missing.

{context}"""

NO_TABLES_REPLY = "No data has been uploaded yet. Upload one or more CSV files (or load the sample dataset) first, then ask your question."
NO_AS_OF_REPLY = "I need an As-of Date before I can answer. Set it in the header (the date to treat as today, e.g. 2024-11-04), then ask again."


class Plan(BaseModel):
    """The analysis plan."""

    sub_questions: list[str] = Field(default_factory=list, description="Independent, self-contained sub-questions. Exactly one for now.")
    direct_reply: str | None = Field(default=None, description="Set only (with empty sub_questions) when the question can't be answered from this data.")


def orchestrator(state: State, runtime: Runtime[Context]) -> dict:
    emit("step", node="orchestrator", message="Planning the analysis")
    # Decided in code, before any model call.
    if state["schema_profile"] == schema_profile.NO_TABLES:
        return {"direct_reply": NO_TABLES_REPLY}
    if not state["as_of_date"]:
        return {"direct_reply": NO_AS_OF_REPLY}
    plan = call_structured(
        runtime.context.model,
        "orchestrator",
        Plan,
        [SystemMessage(SYSTEM.format(context=dataset_context(state))), HumanMessage(state["question"])],
    )
    if plan.direct_reply:
        return {"direct_reply": plan.direct_reply}
    if not plan.sub_questions:
        raise ValueError("The Orchestrator returned neither sub-questions nor a direct reply")
    # ticket #8 (fan-out): drop the [:1]; graph.fan_out already sends one SQL Analyst per sub-question.
    return {"sub_questions": plan.sub_questions[:1]}
