"""Sample dataset, Dataset Notes / As-of Date editing and the Orchestrator's direct replies, through the HTTP API."""

import pytest
from test_ingestion import SAMPLE_ROWS

# The Revenue definition in the sample's Dataset Notes, as SQL: full-year window ending at the As-of Date 2024-11-04.
REVENUE_SQL = """
SELECT sum(o.total_price) AS revenue
FROM orders o
JOIN payment p ON p.order_id = o.order_id AND p.transaction_status = 'Completed'
JOIN shipments s ON s.order_id = o.order_id AND s.shipment_status <> 'Cancelled'
WHERE o.order_date > DATE '2024-11-04' - INTERVAL '1 year' AND o.order_date <= DATE '2024-11-04'
"""


def kinds(events):
    return [e for e, _ in events]


@pytest.fixture
def sample_chat(client, chat_id) -> str:
    assert client.post(f"/chats/{chat_id}/sample").status_code == 200
    return chat_id


def test_one_click_sample_loads_8_tables_notes_and_as_of_date(client, chat_id):
    res = client.post(f"/chats/{chat_id}/sample")
    assert res.status_code == 200
    body = res.json()
    assert {r["table"]: r["rows_loaded"] for r in body["reports"]} == {t: n for t, n in SAMPLE_ROWS.values()}
    assert "Completed" in body["dataset_notes"] and "payment.amount" in body["dataset_notes"]
    assert body["as_of_date"] == "2024-11-04"
    assert len(body["schema_profile"]["relationships"]) >= 7

    chat = client.get(f"/chats/{chat_id}").json()
    assert chat["dataset_notes"] == body["dataset_notes"] and chat["as_of_date"] == "2024-11-04"
    assert len(chat["cleaning_reports"]) == 8


def test_sample_for_an_unknown_chat_is_404(client):
    assert client.post("/chats/00000000-0000-0000-0000-000000000000/sample").status_code == 404


def test_put_updates_notes_and_as_of_date_independently(client, chat_id):
    res = client.put(f"/chats/{chat_id}", json={"dataset_notes": "Revenue is whatever."})
    assert res.status_code == 200 and res.json()["dataset_notes"] == "Revenue is whatever." and res.json()["as_of_date"] is None
    res = client.put(f"/chats/{chat_id}", json={"as_of_date": "2024-03-31"})
    assert res.json()["dataset_notes"] == "Revenue is whatever." and res.json()["as_of_date"] == "2024-03-31"
    assert client.get(f"/chats/{chat_id}").json()["as_of_date"] == "2024-03-31"
    assert client.put(f"/chats/{chat_id}", json={"as_of_date": None}).json()["as_of_date"] is None
    assert client.put(f"/chats/{chat_id}", json={"as_of_date": "yesterday"}).status_code == 422
    assert client.put("/chats/00000000-0000-0000-0000-000000000000", json={}).status_code == 404


def test_edited_dataset_notes_reach_the_next_answers_prompts(client, sample_chat, ask, fake_model):
    new_notes = "Revenue excludes Failed payments only (edited)."
    assert client.put(f"/chats/{sample_chat}", json={"dataset_notes": new_notes}).status_code == 200
    fake_model.script("orchestrator", {"sub_questions": ["Total revenue?"]})
    fake_model.script("sql_analyst", {"sql": "SELECT 1 AS one"}).script("synthesizer", "ok")
    ask(sample_chat, "Total revenue?")
    for role in ("orchestrator", "sql_analyst", "synthesizer"):
        prompt = fake_model.prompt_text(role)
        assert new_notes in prompt and "non-Cancelled" not in prompt and "payment.amount" not in prompt, role


def test_revenue_follows_the_notes_definition_and_hits_the_golden_figure(sample_chat, ask, fake_model):
    fake_model.script("orchestrator", {"sub_questions": ["Total revenue for the past year (2023-11-05 to 2024-11-04)?"]})
    fake_model.script("sql_analyst", {"sql": REVENUE_SQL}).script("synthesizer", "As of 2024-11-04, revenue is 32,398,768.21.")
    events = ask(sample_chat, "What is the total revenue for the past year?")
    assert kinds(events)[-1] == "answer"
    assert "Completed" in fake_model.prompt_text("sql_analyst")  # the Notes' definition reached the analyst
    assert "32398768.21" in fake_model.prompt_text("synthesizer")  # the real data through the real guard


def test_question_before_any_upload_gets_an_upload_first_reply_without_a_model_call(client, chat_id, ask, fake_model):
    events = ask(chat_id, "What is the total revenue?")
    assert kinds(events)[-1] == "answer" and "sql" not in kinds(events) and "error" not in kinds(events)
    answer = events[-1][1]
    assert "upload" in answer["text"].lower() and answer["charts"] == []
    assert "".join(d["text"] for e, d in events if e == "token") == answer["text"]
    assert {d["node"] for e, d in events if e == "step"} == {"orchestrator"}
    assert all(fake_model.prompts(role) == [] for role in ("orchestrator", "sql_analyst", "synthesizer"))


@pytest.mark.parametrize("as_of", ["", None])
def test_missing_as_of_date_is_asked_for_without_a_model_call(client, sample_chat, fake_model, as_of):
    body = {"question": "Revenue for the past year?"} | ({} if as_of is None else {"as_of_date": as_of})
    res = client.post(f"/chats/{sample_chat}/messages", json=body)
    assert res.status_code == 200 and "event: sql" not in res.text and "event: error" not in res.text
    assert "event: answer" in res.text and "As-of Date" in res.text
    assert fake_model.prompts("orchestrator") == []


def test_unanswerable_question_gets_a_plain_cant_answer_reply_with_no_fan_out(client, sample_chat, ask, fake_model):
    reply = "I can't answer that from this data: there is no weather information in these Tables."
    fake_model.script("orchestrator", {"sub_questions": [], "direct_reply": reply})
    events = ask(sample_chat, "What will the weather be tomorrow?")
    assert kinds(events)[0] == "step" and kinds(events)[-1] == "answer" and "sql" not in kinds(events)
    assert events[-1][1]["text"] == reply and events[-1][1]["charts"] == []
    assert "".join(d["text"] for e, d in events if e == "token") == reply
    assert {d["node"] for e, d in events if e == "step"} == {"orchestrator"}
    assert fake_model.prompts("sql_analyst") == [] and fake_model.prompts("synthesizer") == []
    assert "can't be answered" in fake_model.prompt_text("orchestrator")  # the Orchestrator was told it may decline
