"""Graph wiring: START -> orchestrator -> sql_analyst (one per sub-question, via Send) -> chart_builder -> synthesizer -> record_turn -> END.

Adding a node: write it in its own module under app/agents, register it here, extend `State` in app/state.py.
- Chart Builder (#7): node between `sql_analyst` and `synthesizer`; sees all `results`, appends validated `charts`.
- Fan-out: the Orchestrator returns 1..MAX_SUB_QUESTIONS sub-questions; `fan_out` sends one SQL Analyst each, in parallel.
- Direct replies (#10): `route` sends them to `direct_reply`, skipping analysts, Chart Builder and Synthesizer.
- Persistence (#9): the graph is compiled with a checkpointer (thread id = chat id); `record_turn` ends both paths.
"""

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agents.chart_builder import chart_builder
from app.agents.direct_reply import direct_reply
from app.agents.orchestrator import orchestrator
from app.agents.record_turn import record_turn
from app.agents.sql_analyst import sql_analyst
from app.agents.synthesizer import synthesizer
from app.state import DATASET_INFO_KEYS, Context, State


def fan_out(state: State) -> list[Send]:
    shared = {k: state[k] for k in DATASET_INFO_KEYS}
    return [Send("sql_analyst", {**shared, "task": i, "sub_question": q}) for i, q in enumerate(state["sub_questions"])]


def route(state: State) -> str | list[Send]:
    """A direct reply skips the analysts and the Synthesizer; otherwise fan out."""
    return "direct_reply" if state.get("direct_reply") else fan_out(state)


def build_graph(checkpointer):
    g = StateGraph(State, context_schema=Context)
    g.add_node("orchestrator", orchestrator)
    g.add_node("direct_reply", direct_reply)
    g.add_node("sql_analyst", sql_analyst)
    g.add_node("chart_builder", chart_builder)
    g.add_node("synthesizer", synthesizer)
    g.add_node("record_turn", record_turn)
    g.add_edge(START, "orchestrator")
    g.add_conditional_edges("orchestrator", route, ["sql_analyst", "direct_reply"])
    g.add_edge("sql_analyst", "chart_builder")  # runs once, after all parallel SQL Analysts of the question
    g.add_edge("chart_builder", "synthesizer")
    g.add_edge("synthesizer", "record_turn")
    g.add_edge("direct_reply", "record_turn")
    g.add_edge("record_turn", END)
    return g.compile(checkpointer=checkpointer)
