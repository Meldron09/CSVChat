"""Synthesizer: merges the results into the final Answer, streaming its text."""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime

from app.agents.common import dataset_context, stream_text
from app.events import emit
from app.state import Context, State

SYSTEM = """You are the Synthesizer of a data analysis assistant. Answer the user's question in plain language from the
query results below, quoting the key numbers. Be concise. Do not invent numbers that are not in the results.
State the As-of Date you used (for example "As of 2024-11-04, ...") so the user can see how relative dates were read.

{context}

Query results:
{results}"""


def synthesizer(state: State, runtime: Runtime[Context]) -> dict:
    emit("step", node="synthesizer", message="Writing the answer")
    results = json.dumps(state.get("results", []), default=str)  # default=str: Decimal, date
    messages = [SystemMessage(SYSTEM.format(context=dataset_context(state), results=results)), HumanMessage(state["question"])]
    text = ""
    for token in stream_text(runtime.context.model, "synthesizer", messages):
        text += token
        emit("token", text=token)
    if state["as_of_date"] not in re.sub("[‐-―]", "-", text):  # the Answer must always state the As-of Date (models like Unicode hyphens)
        suffix = f"\n\n(As-of Date used: {state['as_of_date']}.)"
        text += suffix
        emit("token", text=suffix)
    emit("answer", text=text, as_of_date=state["as_of_date"], charts=state.get("charts", []))
    return {"answer": text}
