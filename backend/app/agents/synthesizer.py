"""Synthesizer: merges the results into the final Answer, streaming its text."""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime

from app.agents.common import dataset_context, ordered_results, stream_text
from app.agents.orchestrator import MAX_SUB_QUESTIONS
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

{dropped}

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


def dropped_block(state: State) -> str:
    """Parts of the question the Orchestrator had to leave out (over the fan-out cap): the Answer must say so plainly."""
    dropped = state.get("dropped_sub_questions", [])
    if not dropped:
        return ""
    parts = "".join(f"\n- {q}" for q in dropped)
    return (
        "Parts of the user's question that were NOT analysed (the question had too many parts) and have no results:"
        f"{parts}\nSay plainly in your answer that these parts were not answered and that the user can ask them in a follow-up. Never guess them."
    )


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
        system = SYSTEM.format(charts=charts_block(state), dropped=dropped_block(state), context=dataset_context(state), results=json.dumps(results, default=str), failures=failures)  # default=str: Decimal, date
        messages = [SystemMessage(system), HumanMessage(state["question"])]
        text = ""
        for token in stream_text(runtime.context.model, "synthesizer", messages):
            text += token
            emit("token", text=token)
    if any(r["truncated"] for r in results) and not re.search(r"1,?000|truncat", text):  # same guarantee for the row cap
        suffix = "\n\n(Note: a query returned more than 1,000 rows; only the first 1,000 were used.)"
        text += suffix
        emit("token", text=suffix)
    dropped = state.get("dropped_sub_questions", [])
    if dropped and not re.search(r"(not|n't) (be |been |was |were )?(answered|analy[sz]ed|covered|addressed)|unanswered|(did not|didn't) (answer|cover)", text, re.I):
        suffix = (  # same guarantee for the fan-out cap: the user always learns what was left out
            f"\n\n(Not answered: the question had more than {MAX_SUB_QUESTIONS} parts and only the first {MAX_SUB_QUESTIONS} were analysed. "
            f"Not covered: {'; '.join(dropped)}. Ask them in a follow-up.)"
        )
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
