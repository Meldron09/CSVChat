"""Direct reply: the Orchestrator's answer when there is nothing to analyse (no Tables, no As-of Date, unanswerable).
Streams like the Synthesizer (`token`s, then `answer`) but runs no SQL and has no charts."""

import re

from app.events import emit
from app.state import State


def direct_reply(state: State) -> dict:
    text = state["direct_reply"]
    for token in re.findall(r"\S+\s*", text):
        emit("token", text=token)
    emit("answer", text=text, as_of_date=state["as_of_date"] or None, charts=[])
    return {"answer": text}
