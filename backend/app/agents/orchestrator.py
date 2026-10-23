"""Orchestrator: turns the question into independent sub-questions for the SQL Analysts."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

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

{context}"""


class Plan(BaseModel):
    """The analysis plan."""

    sub_questions: list[str] = Field(
        min_length=1,
        description=f"Plain-English strings (not SQL): independent, self-contained sub-questions in the order the user asked them: one for a simple question, at most {MAX_SUB_QUESTIONS}.",
    )


def orchestrator(state: State, runtime: Runtime[Context]) -> dict:
    emit("step", node="orchestrator", message="Planning the analysis")
    plan = call_structured(
        runtime.context.model,
        "orchestrator",
        Plan,
        [SystemMessage(SYSTEM.format(max=MAX_SUB_QUESTIONS, context=dataset_context(state))), HumanMessage(state["question"])],
    )
    if len(plan.sub_questions) > MAX_SUB_QUESTIONS:  # truncate rather than fail: the model may overshoot
        emit("step", node="orchestrator", message=f"The question has {len(plan.sub_questions)} parts; answering the first {MAX_SUB_QUESTIONS}")
    return {"sub_questions": plan.sub_questions[:MAX_SUB_QUESTIONS]}
