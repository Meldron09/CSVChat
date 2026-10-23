"""Record turn: the last node of every successful run (Answer or direct reply); appends the finished turn to the
checkpointed transcript. A run that fails earlier records nothing, so the thread only ever holds complete turns."""

from app.state import State


def record_turn(state: State) -> dict:
    queries = [
        {k: r[k] for k in ("task", "sub_question", "sql", "error")}
        for r in sorted(state.get("results", []), key=lambda r: r["task"])
    ]
    turn = {
        "question": state["question"],
        "as_of_date": state["as_of_date"],
        "queries": queries,
        "answer": state["answer"],
        "charts": state.get("charts", []),
    }
    return {"turns": [turn]}
