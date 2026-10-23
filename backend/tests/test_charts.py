"""Charts in Answers: Chart Builder + Chart Spec validation, through the HTTP API with the scripted fake model."""

import pytest
from test_ingestion import upload
from test_messages import ORDERS

from app.chart_spec import ChartSpec

MONTHLY = "SELECT to_char(order_date, 'YYYY-MM') AS month, sum(total_price) AS revenue FROM orders GROUP BY 1 ORDER BY 1"


def line(**over):
    spec = {
        "type": "line",
        "title": "Monthly revenue",
        "x_key": "month",
        "x_label": "Month",
        "y_label": "Revenue",
        "series": [{"key": "revenue", "label": "Revenue"}],
        "data": [{"month": "2024-01", "revenue": 10.5}, {"month": "2024-02", "revenue": 20.25}, {"month": "2024-03", "revenue": 30}],
    }
    return {**spec, **over}


def bar(**over):
    return line(**{"type": "bar", "title": "Revenue by month", **over})


@pytest.fixture
def chat(client, chat_id, fake_model) -> str:
    assert upload(client, chat_id, ("orders.csv", ORDERS)).status_code == 200
    fake_model.script("orchestrator", {"sub_questions": ["Revenue per month?"]})
    fake_model.script("sql_analyst", {"sql": MONTHLY})
    fake_model.script("synthesizer", "Revenue grew every month.")
    return chat_id


def test_trend_question_returns_a_line_chart_in_the_answer(chat, ask, fake_model):
    fake_model.script("chart_builder", {"charts": [line()]})
    events = ask(chat, "How did revenue trend by month?")

    answer = events[-1]
    assert answer[0] == "answer" and answer[1]["text"].startswith("Revenue grew every month.")
    (chart,) = answer[1]["charts"]
    assert chart["type"] == "line" and chart["title"] == "Monthly revenue" and len(chart["data"]) == 3
    assert ChartSpec.model_validate(chart).model_dump() == chart
    assert "2024-02" in fake_model.prompt_text("chart_builder")  # the query result reached the Chart Builder
    assert "Monthly revenue" in fake_model.prompt_text("synthesizer")  # and the Synthesizer knows what is drawn


def test_category_comparison_returns_a_bar_chart_and_charts_only_travel_in_the_answer(chat, ask, fake_model):
    fake_model.script("chart_builder", {"charts": [bar()]})
    events = ask(chat, "Compare revenue across months")

    assert [d["charts"][0]["type"] for e, d in events if e == "answer"] == ["bar"]
    assert [e for e, _ in events].count("answer") == 1
    for e, d in events[:-1]:  # no chart data in any earlier event
        assert "charts" not in d and "2024-02" not in str(d.get("message", "")) and e != "answer"


def test_no_chart_when_text_says_it_better(chat, ask, fake_model):
    events = ask(chat, "What is the revenue?")  # unscripted Chart Builder answers "no charts"
    assert events[-1][1]["charts"] == []
    assert "No charts are shown" in fake_model.prompt_text("synthesizer")


@pytest.mark.parametrize(
    "bad",
    [
        line(type="donut"),
        line(title=""),
        line(y_label=""),
        line(data=[]),
        line(series=[]),
        line(data=[{"month": "2024-01", "revenue": "lots"}]),
        line(data=[{"revenue": 2}]),  # row without the x value
        line(type="pie", series=[{"key": "revenue", "label": "R"}, {"key": "month", "label": "M"}]),
        line(type="scatter"),  # x values are text
        line(type="pie", data=[{"month": "a", "revenue": -1}]),
        {"type": "bar"},
    ],
)
def test_an_invalid_chart_spec_is_rejected_reported_and_never_reaches_the_answer(chat, ask, fake_model, bad):
    fake_model.script("chart_builder", {"charts": [bad, bar()]})
    events = ask(chat, "Compare revenue across months")

    assert [c["title"] for c in events[-1][1]["charts"]] == ["Revenue by month"]  # the valid one still arrives
    steps = [d["message"] for e, d in events if e == "step" and d["node"] == "chart_builder"]
    assert any(m.startswith("Rejected invalid chart") for m in steps)
    assert "Chart problem (do not claim this chart)" in fake_model.prompt_text("synthesizer")
    assert all("charts" not in d for e, d in events if e != "answer")


def test_at_most_three_charts_per_answer(chat, ask, fake_model):
    fake_model.script("chart_builder", {"charts": [bar(title=f"Chart {i}") for i in range(5)]})
    events = ask(chat, "Show me everything")

    assert [c["title"] for c in events[-1][1]["charts"]] == ["Chart 0", "Chart 1", "Chart 2"]
    assert any("Dropped 2 chart(s)" in d["message"] for e, d in events if e == "step")


def test_a_chart_builder_that_never_calls_the_tool_does_not_fail_the_answer(chat, ask, fake_model):
    fake_model.script("chart_builder", "I would rather chat.", "Still chatting.")
    events = ask(chat, "Compare revenue across months")
    assert events[-1][0] == "answer" and events[-1][1]["charts"] == []


@pytest.mark.parametrize(
    "spec",
    [
        line(type="pie", data=[{"month": "Books", "revenue": 3}, {"month": "Toys", "revenue": None}]),
        line(type="scatter", data=[{"month": 1, "revenue": 2.5}, {"month": 2, "revenue": 3}]),
        line(series=[{"key": "revenue", "label": "A"}, {"key": "cost", "label": "B"}], data=[{"month": "x", "revenue": 1, "cost": 2}]),
    ],
)
def test_all_chart_types_validate(spec):
    assert ChartSpec.model_validate(spec).type == spec["type"]
