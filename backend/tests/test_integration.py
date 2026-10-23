"""Seam between the sibling features: sample data + parallel fan-out + Chart Builder + Synthesizer, and direct replies skipping all of them."""

from helpers import assert_valid_stream

PARTS = ["Revenue per year-month?", "How many customers are there?"]
SQL_FOR = {
    PARTS[0]: "SELECT to_char(order_date, 'YYYY-MM') AS month, sum(total_price)::float AS revenue FROM orders WHERE order_date >= DATE '2024-09-01' GROUP BY 1 ORDER BY 1 LIMIT 2",
    PARTS[1]: "SELECT count(*) AS customers FROM customers",
}
BAR = {
    "type": "bar",
    "title": "Revenue by month",
    "x_key": "month",
    "x_label": "Month",
    "y_label": "Revenue",
    "series": [{"key": "revenue", "label": "Revenue"}],
    "data": [{"month": "2024-09", "revenue": 1.5}, {"month": "2024-10", "revenue": 2.5}],
}


def test_two_part_question_on_sample_data_yields_a_chart_only_in_the_answer(sample_chat, ask, fake_model):
    fake_model.script("orchestrator", {"sub_questions": PARTS})
    analyst = lambda messages: {"sql": SQL_FOR[messages[-1].content]}  # noqa: E731
    fake_model.script("sql_analyst", analyst, analyst)
    fake_model.script("chart_builder", {"charts": [BAR]})
    fake_model.script("synthesizer", "As of 2024-11-04, revenue is charted and there are customers.")
    events = ask(sample_chat, "Revenue by month, and how many customers?")

    assert_valid_stream(events)
    kinds = [e for e, _ in events]
    assert "error" not in kinds and sorted(d["task"] for e, d in events if e == "sql") == [0, 1]
    (answer,) = [d for e, d in events if e == "answer"]
    assert [c["type"] for c in answer["charts"]] == ["bar"] and answer["charts"][0]["title"] == "Revenue by month"
    for e, d in events[:-1]:  # no chart data before the answer
        assert "charts" not in d and "2024-10" not in str(d)

    # chart_builder ran once, after both analysts, and saw both results; it comes between the analysts' steps and the first token
    assert len(fake_model.prompts("chart_builder")) == 1
    cb_prompt = fake_model.prompt_text("chart_builder")
    assert all(f'"sub_question": "{q}"' in cb_prompt for q in PARTS)
    node_steps = [d["node"] for e, d in events if e == "step"]
    assert node_steps.index("chart_builder") > max(i for i, n in enumerate(node_steps) if n == "sql_analyst")
    assert node_steps[-1] == "synthesizer"
    assert "Revenue by month" in fake_model.prompt_text("synthesizer")


def test_a_direct_reply_has_no_charts_and_never_reaches_the_chart_builder(client, chat_id, ask, fake_model):
    events = ask(chat_id, "What is revenue?")  # no tables uploaded

    kinds = [e for e, _ in events]
    assert kinds[-1] == "answer" and "error" not in kinds and "sql" not in kinds
    assert events[-1][1]["charts"] == [] and "upload" in events[-1][1]["text"].lower()
    assert {d["node"] for e, d in events if e == "step"} == {"orchestrator"}
    assert not fake_model.prompts("chart_builder") and not fake_model.prompts("synthesizer") and not fake_model.prompts("sql_analyst")
