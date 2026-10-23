"""Chart Builder: turns the query results into validated Chart Specs (at most 3), or none when text says it better."""

import json

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field, ValidationError

from app.agents.common import call_structured, dataset_context
from app.chart_spec import MAX_CHARTS, ChartSpec
from app.events import emit
from app.state import Context, State

SYSTEM = """You are the Chart Builder of a data analysis assistant. From the query results below decide whether the
user's question warrants charts, and if so build them. Return an empty list for a single number, a lookup or anything text
answers just as well. Never build more than __MAX__ charts. Use ONLY values present in the results.

Chart types: "line" for a trend over time, "bar" for comparing categories, "pie" for shares of a whole (few slices),
"scatter" for the relationship between two numeric columns.
Each chart is an object:
{"type": "line"|"bar"|"pie"|"scatter", "title": "...", "x_key": "<row key of the x value>", "x_label": "...", "y_label": "...",
 "series": [{"key": "<row key of a numeric value>", "label": "<legend>"}],
 "data": [{"<x_key>": "2024-01", "<series key>": 123.4}, ...]}
Pie and scatter take exactly one series. Pie: x_key is the slice name. Scatter: x and y are both numeric.
Titles and axis labels must be human readable (units included); sort data rows sensibly (time ascending).

{context}

Query results:
{results}""".replace("__MAX__", str(MAX_CHARTS))


class ChartPlan(BaseModel):
    """The charts to show with the Answer."""

    # raw dicts, validated one by one below, so one bad chart does not discard the good ones
    charts: list[dict] = Field(default_factory=list, description="Chart Specs; empty when no chart is warranted")


def chart_builder(state: State, runtime: Runtime[Context]) -> dict:
    # failed analysts (error set, no rows) are skipped; parallel ones finish in any order, so sort by task
    results = sorted((r for r in state.get("results", []) if r["rows"] and not r.get("error")), key=lambda r: r["task"])
    if not results:
        return {}
    emit("step", node="chart_builder", message="Deciding whether charts are warranted")
    messages = [
        # replace, not format: the prompt's JSON example is full of braces
        SystemMessage(SYSTEM.replace("{context}", dataset_context(state)).replace("{results}", json.dumps(results, default=str))),
        HumanMessage(state["question"]),
    ]
    try:
        plan = call_structured(runtime.context.model, "chart_builder", ChartPlan, messages)
    except ValueError as e:  # a chart is optional: never fail the Answer over it
        return _report([f"the Chart Builder returned no usable output ({e})"], [])
    charts, notes = [], []
    for raw in plan.charts:
        try:
            charts.append(ChartSpec.model_validate(raw).model_dump())
        except ValidationError as e:
            title = raw.get("title", "untitled") if isinstance(raw, dict) else "untitled"
            notes.append(f"rejected invalid chart {title!r}: {e.errors()[0]['msg']}")
    if len(charts) > MAX_CHARTS:
        notes.append(f"dropped {len(charts) - MAX_CHARTS} chart(s) over the limit of {MAX_CHARTS}")
        charts = charts[:MAX_CHARTS]
    return _report(notes, charts)


def _report(notes: list[str], charts: list[dict]) -> dict:
    for n in notes:  # a step (no chart data), and a note for the Synthesizer so the Answer does not claim the chart
        emit("step", node="chart_builder", message=n[0].upper() + n[1:])
    return {"charts": charts, "chart_notes": notes}
