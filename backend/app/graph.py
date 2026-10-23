"""Graph wiring: START -> orchestrator -> sql_analyst (one per sub-question, via Send) -> synthesizer -> END.

Adding a node: write it in its own module under app/agents, register it here, extend `State` in app/state.py.
- Chart Builder (#7): node between `sql_analyst` and `synthesizer`.
- Fan-out: the Orchestrator returns 1..MAX_SUB_QUESTIONS sub-questions; `fan_out` sends one SQL Analyst each, in parallel.
"""

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agents.direct_reply import direct_reply
from app.agents.orchestrator import orchestrator
from app.agents.sql_analyst import sql_analyst
from app.agents.synthesizer import synthesizer
from app.state import Context, State


def fan_out(state: State) -> list[Send]:
    shared = {k: state[k] for k in ("question", "as_of_date", "dataset_notes", "schema_profile")}
    return [Send("sql_analyst", {**shared, "task": i, "sub_question": q}) for i, q in enumerate(state["sub_questions"])]


def route(state: State) -> str | list[Send]:
    """A direct reply skips the analysts and the Synthesizer; otherwise fan out."""
    return "direct_reply" if state.get("direct_reply") else fan_out(state)


def build_graph():
    g = StateGraph(State, context_schema=Context)
    g.add_node("orchestrator", orchestrator)
    g.add_node("direct_reply", direct_reply)
    g.add_node("sql_analyst", sql_analyst)
    g.add_node("synthesizer", synthesizer)
    g.add_edge(START, "orchestrator")
    g.add_conditional_edges("orchestrator", route, ["sql_analyst", "direct_reply"])
    g.add_edge("sql_analyst", "synthesizer")
    g.add_edge("synthesizer", END)
    g.add_edge("direct_reply", END)
    return g.compile()


graph = build_graph()
