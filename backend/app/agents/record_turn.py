"""Record turn: the last node of every successful run (Answer or direct reply); appends the finished turn to the
checkpointed transcript. A run that fails earlier records nothing, so the thread only ever holds complete turns."""

from app.agents.common import ordered_results
from app.state import QueryRecord, State


def record_turn(state: State) -> dict:
    queries = [QueryRecord(**{k: r[k] for k in QueryRecord.__annotations__}) for r in ordered_results(state)]
    turn = {
        "question": state["question"],
        "as_of_date": state["as_of_date"],
        "queries": queries,
        "answer": state["answer"],
        "charts": state.get("charts", []),
    }
    return {"turns": [turn]}
