"""Orchestrator: turns the question into independent sub-questions for the SQL Analysts."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

from app import schema_profile
from app.agents.common import call_structured, dataset_context
from app.events import emit
from app.state import Context, State

MAX_SUB_QUESTIONS = 4  # fan-out cap: each sub-question is one parallel SQL Analyst (one model call + one query)

SYSTEM = """You are the Orchestrator of a data analysis assistant. The user asks a question about their uploaded CSV Tables.
Split it into independent, self-contained sub-questions; each is answered by a separate SQL analyst with ONE query, in parallel.
Each sub-question is a plain-English string (a question, never SQL; the analyst writes the SQL).
- A simple question, or one that is a single analysis (even over several Tables), gives exactly ONE sub-question: the question rewritten.
- A multi-part question ("revenue by month and the top 5 products") gives one sub-question per part, at most {max}. Merge closely related parts.
- Sub-questions must not depend on each other's results, and must not repeat the same analysis.
- A part that spans Tables (for example suppliers vs review ratings) stays ONE sub-question that says which Tables to join and
  to join through the Relationships in the Schema Profile. Never split a join across sub-questions.
Resolve relative dates against the As-of Date and write the resulting absolute dates into each sub-question.
Keep any business definitions from the Dataset Notes that apply (for example how Revenue is defined) in each sub-question that needs them.

If the question cannot be answered from the Tables in the Schema Profile (the data it needs is not there, or it is unrelated to the data), do not invent an answer: leave sub_questions empty and set direct_reply to a short, plain statement that this can't be answered from this data, saying what is missing.

{context}"""

NO_TABLES_REPLY = "No data has been uploaded yet. Upload one or more CSV files (or load the sample dataset) first, then ask your question."
NO_AS_OF_REPLY = "I need an As-of Date before I can answer. Set it in the header (the date to treat as today, e.g. 2024-11-04), then ask again."


class Plan(BaseModel):
    """The analysis plan."""

    sub_questions: list[str] = Field(
        default_factory=list,
        description=f"Plain-English strings (not SQL): independent, self-contained sub-questions in the order the user asked them: one for a simple question, at most {MAX_SUB_QUESTIONS}.",
    )
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
        [SystemMessage(SYSTEM.format(max=MAX_SUB_QUESTIONS, context=dataset_context(state))), HumanMessage(state["question"])],
    )
    if plan.direct_reply:
        return {"direct_reply": plan.direct_reply}
    if not plan.sub_questions:
        raise ValueError("The Orchestrator returned neither sub-questions nor a direct reply")
    if len(plan.sub_questions) > MAX_SUB_QUESTIONS:  # truncate rather than fail: the model may overshoot
        emit("step", node="orchestrator", message=f"The question has {len(plan.sub_questions)} parts; answering the first {MAX_SUB_QUESTIONS}")
    return {"sub_questions": plan.sub_questions[:MAX_SUB_QUESTIONS]}
