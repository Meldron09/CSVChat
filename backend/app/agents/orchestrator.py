"""Orchestrator: turns the question into independent sub-questions for the SQL Analysts."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

from app.agents.common import call_structured, dataset_context
from app.events import emit
from app.state import Context, State

SYSTEM = """You are the Orchestrator of a data analysis assistant. The user asks a question about their uploaded CSV Tables.
Rewrite it as ONE self-contained sub-question a SQL analyst can answer with a single query.
Resolve relative dates against the As-of Date and write the resulting absolute dates into the sub-question.
Keep any business definitions from the Dataset Notes that apply (for example how Revenue is defined).

{context}"""


class Plan(BaseModel):
    """The analysis plan."""

    sub_questions: list[str] = Field(min_length=1, description="Independent, self-contained sub-questions. Exactly one for now.")


def orchestrator(state: State, runtime: Runtime[Context]) -> dict:
    emit("step", node="orchestrator", message="Planning the analysis")
    plan = call_structured(
        runtime.context.model,
        "orchestrator",
        Plan,
        [SystemMessage(SYSTEM.format(context=dataset_context(state))), HumanMessage(state["question"])],
    )
    # ticket #8 (fan-out): drop the [:1]; graph.fan_out already sends one SQL Analyst per sub-question.
    return {"sub_questions": plan.sub_questions[:1]}
