"""Charts in Answers: Chart Builder + Chart Spec validation, through the HTTP API with the scripted fake model."""

import pytest
from helpers import MONTHLY, ORDERS, bar, line, upload


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
    assert chart == line()  # arrives exactly as the Chart Builder produced it (validation changes nothing)
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
        line(series=[{"key": "revnue", "label": "Revenue"}]),  # series key (a typo) that no row has: would draw nothing
        line(series=[{"key": "revenue", "label": "R"}, {"key": "cost", "label": "C"}]),  # second series key in no row
        line(data=[{"month": "2024-01", "revenue": None}, {"month": "2024-02", "revenue": None}]),  # series with no value at all
        line(data=[{"month": f"d{i}", "revenue": i} for i in range(2001)]),  # over the row cap
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
def test_all_chart_types_arrive_in_the_answer(chat, ask, fake_model, spec):
    fake_model.script("chart_builder", {"charts": [spec]})
    (chart,) = ask(chat, "Show me")[-1][1]["charts"]
    assert chart["type"] == spec["type"] and chart["data"] == spec["data"]


def daily(n: int, **over) -> dict:
    return line(title="Daily revenue", data=[{"month": f"day-{i:04d}", "revenue": i * 1.5} for i in range(n)], **over)


@pytest.mark.parametrize("points", [365, 730, 2000])
def test_a_daily_series_of_a_year_or_more_is_a_valid_line_chart(chat, ask, fake_model, points):
    fake_model.script("chart_builder", {"charts": [daily(points)]})
    events = ask(chat, "Daily revenue trend")

    (chart,) = events[-1][1]["charts"]
    assert chart["type"] == "line" and len(chart["data"]) == points
    assert all(not m.startswith("Rejected") for e, d in events if e == "step" for m in [d["message"]])


def test_legitimate_gaps_still_validate(chat, ask, fake_model):
    gappy = line(
        series=[{"key": "revenue", "label": "Revenue"}, {"key": "cost", "label": "Cost"}],
        data=[{"month": "2024-01", "revenue": 1, "cost": None}, {"month": "2024-02", "revenue": None, "cost": 2}, {"month": "2024-03", "revenue": 3}],
    )
    fake_model.script("chart_builder", {"charts": [gappy]})
    (chart,) = ask(chat, "Revenue and cost")[-1][1]["charts"]
    assert [r.get("cost") for r in chart["data"]] == [None, 2, None]
