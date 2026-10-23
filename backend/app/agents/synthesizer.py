"""Synthesizer: merges the results into the final Answer, streaming its text."""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime

from app.agents.common import dataset_context, ordered_results, stream_text
from app.agents.sql_analyst import MAX_RETRIES
from app.events import emit
from app.state import Context, State

SYSTEM = """You are the Synthesizer of a data analysis assistant. Answer the user's question in plain language from the
query results below, quoting the key numbers. Be concise. Do not invent numbers that are not in the results.
The results come from independent sub-questions, one entry per sub-question in the order the user asked them: cover each in
that order and merge them into one coherent answer, not separate replies. A simple question has a single result.
If previous turns are shown, answer only the new question; they are context for follow-ups.
State the As-of Date you used (for example "As of 2024-11-04, ...") so the user can see how relative dates were read.
Results marked "truncated": true hold only the first 1,000 rows of a larger result: say so, and do not present totals over those rows as complete.
Each entry under "Failed parts" could not be answered: state plainly that it failed and why. Never guess, estimate or fill it in.

{charts}

{context}

Query results:
{results}

Failed parts:
{failures}"""


def charts_block(state: State) -> str:
    """Tell the Synthesizer which charts will be drawn next to its text, so it neither claims nor omits them."""
    titles = [c["title"] for c in state.get("charts", [])]
    out = f"Charts shown to the user beside your answer: {titles}. You may refer to them." if titles else "No charts are shown: do not mention or promise any chart."
    return "\n".join([out, *(f"Chart problem (do not claim this chart): {n}" for n in state.get("chart_notes", []))])


def synthesizer(state: State, runtime: Runtime[Context]) -> dict:
    emit("step", node="synthesizer", message="Writing the answer")
    ordered = ordered_results(state)  # merge in the order asked
    results = [r for r in ordered if not r["error"]]
    failed = [r for r in ordered if r["error"]]
    if failed and not results:  # nothing to synthesize: report plainly without asking the model, so it cannot invent an answer
        text = f"As of {state['as_of_date']}, I could not answer this question.\n" + "".join(_failure_line(r) for r in failed)
        emit("token", text=text)
    else:
        failures = "".join(_failure_line(r) for r in failed) or "(none)\n"
        system = SYSTEM.format(charts=charts_block(state), context=dataset_context(state), results=json.dumps(results, default=str), failures=failures)  # default=str: Decimal, date
        messages = [SystemMessage(system), HumanMessage(state["question"])]
        text = ""
        for token in stream_text(runtime.context.model, "synthesizer", messages):
            text += token
            emit("token", text=token)
    if any(r["truncated"] for r in results) and not re.search(r"1,?000|truncat", text):  # same guarantee for the row cap
        suffix = "\n\n(Note: a query returned more than 1,000 rows; only the first 1,000 were used.)"
        text += suffix
        emit("token", text=suffix)
    if state["as_of_date"] not in re.sub("[‐-―]", "-", text):  # the Answer must always state the As-of Date (models like Unicode hyphens)
        suffix = f"\n\n(As-of Date used: {state['as_of_date']}.)"
        text += suffix
        emit("token", text=suffix)
    emit("answer", text=text, as_of_date=state["as_of_date"], charts=state.get("charts", []))
    return {"answer": text}


def _failure_line(r) -> str:
    return f"- \"{r['sub_question']}\" failed after {MAX_RETRIES + 1} attempts. Last query: {r['sql']} Database error: {r['error']}\n"
