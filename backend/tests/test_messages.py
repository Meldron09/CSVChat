"""Asking a question: SSE stream, prompts and SQL guard, through the HTTP API with the scripted fake model."""

import dataclasses
import uuid

import pytest
from fastapi.testclient import TestClient
from test_ingestion import upload

from app.main import create_app

NOTES = "Revenue means completed payments only."
ORDERS = b"order_id,order_date,total_price\n1,2024-01-05,10.50\n2,2024-02-06,20.25\n3,2024-03-07,30.00\n"
CUSTOMERS = b"customer_id,name\n1,Ann\n2,Bob\n"


@pytest.fixture
def loaded_chat(client, chat_id) -> str:
    assert upload(client, chat_id, ("orders.csv", ORDERS), ("customers.csv", CUSTOMERS), notes=NOTES).status_code == 200
    return chat_id


def script_happy_path(fake, sql="SELECT sum(total_price) AS revenue FROM orders", answer="Total revenue is 60.75."):
    fake.script("orchestrator", {"sub_questions": ["What is the total revenue?"]})
    fake.script("sql_analyst", {"sql": sql})
    fake.script("synthesizer", answer)


def names(events):
    return [e for e, _ in events]


def test_events_stream_in_order_and_the_answer_is_the_streamed_text(loaded_chat, ask, fake_model):
    script_happy_path(fake_model)
    events = ask(loaded_chat, "What is the total revenue?")

    kinds = names(events)
    assert kinds[0] == "step" and kinds[-1] == "answer" and "error" not in kinds
    assert kinds.index("sql") < kinds.index("token") < kinds.index("answer")
    assert {d["node"] for e, d in events if e == "step"} == {"orchestrator", "sql_analyst", "synthesizer"}
    assert [d["sql"] for e, d in events if e == "sql"] == ["SELECT sum(total_price) AS revenue FROM orders"]

    streamed = "".join(d["text"] for e, d in events if e == "token")
    answer = events[-1][1]
    assert answer["text"] == streamed
    assert answer["text"].startswith("Total revenue is 60.75.") and answer["charts"] == []
    assert "60.75" in fake_model.prompt_text("synthesizer")  # the query result reached the Synthesizer


def test_as_of_date_and_dataset_notes_reach_the_prompts_and_the_answer_states_the_date(loaded_chat, ask, fake_model):
    script_happy_path(fake_model, answer="Total revenue is 60.75.")  # the model forgot to mention the date
    events = ask(loaded_chat, "Revenue for the past year?", as_of_date="2024-03-31")

    for role in ("orchestrator", "sql_analyst", "synthesizer"):
        prompt = fake_model.prompt_text(role)
        assert "2024-03-31" in prompt and NOTES in prompt, role
    assert "orders" in fake_model.prompt_text("sql_analyst")  # Schema Profile
    assert "Revenue for the past year?" in fake_model.prompt_text("orchestrator")
    assert "What is the total revenue?" in fake_model.prompt_text("sql_analyst")  # the Orchestrator's sub-question
    assert "2024-03-31" in events[-1][1]["text"]


def test_a_model_that_skips_the_tool_call_is_nudged_once(loaded_chat, ask, fake_model):
    fake_model.script("orchestrator", "I would rather chat.", {"sub_questions": ["What is the total revenue?"]})
    fake_model.script("sql_analyst", {"sql": "SELECT 1 AS one"}).script("synthesizer", "ok")
    assert names(ask(loaded_chat, "revenue"))[-1] == "answer"
    assert "calling the Plan tool" in fake_model.prompt_text("orchestrator")  # the second attempt carried the nudge


@pytest.mark.parametrize(
    "bad_sql",
    [
        "DROP TABLE orders",
        "DELETE FROM orders",
        "SELECT 1; DROP TABLE orders",
        "WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d",
        "SELECT * INTO stolen FROM orders",
        "SET ROLE csvchat_owner",
    ],
)
def test_non_select_sql_is_rejected_before_execution_and_data_is_untouched(loaded_chat, ask, fake_model, client, bad_sql):
    script_happy_path(fake_model, sql=bad_sql)
    events = ask(loaded_chat, "break it")

    assert names(events)[-1] == "error" and "answer" not in names(events)
    assert fake_model.prompts("synthesizer") == []  # never got as far as the Synthesizer
    script_happy_path(fake_model, sql="SELECT count(*) AS n FROM orders")
    ask(loaded_chat, "how many orders")
    assert "3" in fake_model.prompt_text("synthesizer")  # still three orders


def test_sql_runs_as_the_chats_own_role_with_its_schema_as_search_path(loaded_chat, ask, fake_model):
    script_happy_path(fake_model, sql="SELECT current_user AS u, current_schema() AS s")
    ask(loaded_chat, "who am I")
    expected = f"chat_{uuid.UUID(loaded_chat).hex}"
    assert f'"rows": [["{expected}", "{expected}"]]' in fake_model.prompt_text("synthesizer")


def test_a_chat_cannot_read_another_chats_tables_through_the_agent(loaded_chat, client, ask, fake_model):
    other = client.post("/chats").json()["id"]
    upload(client, other, ("secrets.csv", b"id,secret\n1,hunter2\n"))
    other_schema = f"chat_{uuid.UUID(other).hex}"

    script_happy_path(fake_model, sql=f"SELECT * FROM {other_schema}.secrets")
    events = ask(loaded_chat, "peek")
    assert names(events)[-1] == "error" and "permission denied" in events[-1][1]["message"]
    assert "hunter2" not in str(events)


def test_a_runaway_query_is_cut_off_by_the_statement_timeout(settings, loaded_chat, fake_model):
    quick = dataclasses.replace(settings, sql_timeout_ms=300)
    script_happy_path(fake_model, sql="SELECT pg_sleep(5)")
    with TestClient(create_app(quick, model_factory=lambda _: fake_model)) as c:
        res = c.post(f"/chats/{loaded_chat}/messages", json={"question": "slow", "as_of_date": "2024-11-04"})
    assert "event: error" in res.text and "statement timeout" in res.text


@pytest.mark.parametrize("chat", [str(uuid.uuid4()), "not-a-uuid"])
def test_unknown_chat_is_404(client, chat):
    assert client.post(f"/chats/{chat}/messages", json={"question": "hi", "as_of_date": "2024-11-04"}).status_code == 404


@pytest.mark.parametrize("body", [{"as_of_date": "2024-11-04"}, {"question": "hi", "as_of_date": "yesterday"}, {"question": "", "as_of_date": "2024-11-04"}])
def test_invalid_message_body_is_422(client, chat_id, body):
    assert client.post(f"/chats/{chat_id}/messages", json=body).status_code == 422
