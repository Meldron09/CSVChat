"""SQL failure handling and adversarial safety, through the HTTP API with the scripted fake model.

Ordinary database errors are retried (twice) with the error fed back; guard rejections, permission errors and
timeouts are terminal `error` events. Either way the Chat's data is never changed."""

import dataclasses
import threading
import time

import psycopg
import pytest
from fastapi.testclient import TestClient
from helpers import names, schema_of, script_happy_path

from app.main import create_app

ONE_SUB_QUESTION = {"sub_questions": ["What is the total revenue?"]}
BAD_SQL = "SELECT revenue FROM orders"  # column does not exist: an ordinary, fixable error


def assert_orders_untouched(settings, chat_id):
    """Checked over the owner connection, not through the agent path."""
    with psycopg.connect(settings.owner_dsn) as owner:
        schema = schema_of(chat_id)
        assert owner.execute(f'SELECT count(*), sum(total_price) FROM "{schema}".orders').fetchone() == (3, 60.75)
        assert owner.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = %s", [schema]).fetchone() == (2,)


def test_a_failed_query_is_retried_with_the_database_error_and_the_answer_uses_the_fix(loaded_chat, ask, fake_model):
    fake_model.script("orchestrator", ONE_SUB_QUESTION)
    fake_model.script("sql_analyst", {"sql": BAD_SQL}, {"sql": "SELECT sum(total_price) AS revenue FROM orders"})
    fake_model.script("synthesizer", "Total revenue is 60.75.")
    events = ask(loaded_chat, "revenue?")

    assert names(events)[-1] == "answer" and "error" not in names(events)
    assert len(fake_model.prompts("sql_analyst")) == 2
    retry_prompt = fake_model.prompt_text("sql_analyst", call=1)
    assert BAD_SQL in retry_prompt and 'column "revenue" does not exist' in retry_prompt  # the database error was fed back
    assert len([e for e in events if e[0] == "sql"]) == 2
    assert "Failed parts:\n(none)" in fake_model.prompt_text("synthesizer")


def test_after_two_retries_the_answer_reports_the_failure_and_the_model_is_not_asked_to_guess(loaded_chat, ask, fake_model, settings):
    fake_model.script("orchestrator", ONE_SUB_QUESTION)
    fake_model.script("sql_analyst", *[{"sql": BAD_SQL}] * 3)
    events = ask(loaded_chat, "revenue?")

    assert names(events)[-1] == "answer" and "error" not in names(events)
    assert len(fake_model.prompts("sql_analyst")) == 3  # first attempt + 2 retries, no more
    text = events[-1][1]["text"]
    assert "could not answer" in text and "2024-11-04" in text
    assert 'column "revenue" does not exist' in text and "What is the total revenue?" in text
    assert "".join(d["text"] for e, d in events if e == "token") == text
    assert fake_model.prompts("synthesizer") == []  # nothing to synthesize, nothing to invent
    assert_orders_untouched(settings, loaded_chat)


@pytest.mark.parametrize("sql", ["SELECT total_price / 0 FROM orders", "SELECT * FROM orders WHERE", "SELECT * FROM nope"])
def test_ordinary_database_errors_are_retryable(loaded_chat, ask, fake_model, sql):
    fake_model.script("orchestrator", ONE_SUB_QUESTION).script("sql_analyst", {"sql": sql}, {"sql": "SELECT 1 AS one"})
    fake_model.script("synthesizer", "ok")
    assert names(ask(loaded_chat, "q"))[-1] == "answer" and len(fake_model.prompts("sql_analyst")) == 2


def test_results_are_capped_at_1000_rows_and_the_model_and_answer_are_told(loaded_chat, ask, fake_model):
    script_happy_path(fake_model, sql="SELECT g AS n FROM generate_series(1, 5000) AS g", answer="The numbers are 1 to 5000.")
    events = ask(loaded_chat, "list numbers")

    prompt = fake_model.prompt_text("synthesizer")
    assert '"truncated": true' in prompt and "[1000]" in prompt and "[1001]" not in prompt
    assert "only the first 1,000" in events[-1][1]["text"]  # the Answer says so even though the scripted text did not


def test_exactly_1000_rows_is_not_truncated(loaded_chat, ask, fake_model):
    script_happy_path(fake_model, sql="SELECT g AS n FROM generate_series(1, 1000) AS g", answer="1000 numbers.")
    ask(loaded_chat, "list numbers")
    assert '"truncated": false' in fake_model.prompt_text("synthesizer")


def test_the_default_statement_timeout_is_10_seconds(loaded_chat, ask, fake_model):
    script_happy_path(fake_model, sql="SELECT current_setting('statement_timeout') AS t")
    ask(loaded_chat, "timeout?")
    assert '"rows": [["10s"]]' in fake_model.prompt_text("synthesizer")


ADVERSARIAL = {
    "drop": "DROP TABLE orders",
    "multi_statement": "SELECT 1; DROP TABLE orders",
    "multi_statement_select": "SELECT 1; SELECT 2",
    "writable_cte": "WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d",
    "cross_schema": "SELECT * FROM {other}.secrets",
    "app_schema": "SELECT * FROM app.chats",
    "runaway": "SELECT pg_sleep(5)",
}


@pytest.mark.parametrize("name", ADVERSARIAL)
def test_adversarial_sql_gives_a_terminal_error_event_and_leaves_data_unchanged(settings, client, loaded_chat, fake_model, name):
    other = client.post("/chats").json()["id"]
    with psycopg.connect(settings.owner_dsn, autocommit=True) as owner:
        owner.execute(f'CREATE TABLE "{schema_of(other)}".secrets AS SELECT 1 AS x')
    sql = ADVERSARIAL[name].format(other=schema_of(other))
    # three scripted queries: a retry would consume them, so the call count below proves there was none
    fake_model.script("orchestrator", ONE_SUB_QUESTION).script("sql_analyst", *[{"sql": sql}] * 3)
    quick = dataclasses.replace(settings, sql_timeout_ms=300)  # keep the runaway case fast
    with TestClient(create_app(quick, model_factory=lambda _: fake_model)) as c:
        res = c.post(f"/chats/{loaded_chat}/messages", json={"question": "break it", "as_of_date": "2024-11-04"})

    frames = [f for f in res.text.split("\n\n") if f.strip()]
    assert frames[-1].startswith("event: error") and "event: answer" not in res.text
    assert len(fake_model.prompts("sql_analyst")) == 1 and fake_model.prompts("synthesizer") == []
    assert_orders_untouched(settings, loaded_chat)


def test_a_rejected_query_still_records_the_turn_with_its_sibling_analysts_and_the_thread_stays_usable(settings, loaded_chat, client, ask, fake_model):
    parts = ["Drop it?", "How many orders?"]
    sqls = {parts[0]: "DROP TABLE orders", parts[1]: "SELECT count(*) AS n FROM orders"}
    both_started = threading.Barrier(2, timeout=10)

    def analyst(messages):
        sub_question = messages[-1].content
        both_started.wait()
        if sub_question == parts[0]:
            time.sleep(0.3)  # the sibling's query is reported before this one is rejected
        return {"sql": sqls[sub_question]}

    fake_model.script("orchestrator", {"sub_questions": parts}).script("sql_analyst", analyst, analyst)
    events = ask(loaded_chat, "drop it and count")
    assert names(events)[-1] == "error" and "Only SELECT/WITH" in events[-1][1]["message"] and "answer" not in names(events)

    (turn,) = client.get(f"/chats/{loaded_chat}").json()["transcript"]  # the turn is not lost
    assert turn["question"] == "drop it and count" and turn["answer"] == "" and "Only SELECT/WITH" in turn["error"]
    assert {q["task"]: q["sql"] for q in turn["queries"]} == {0: sqls[parts[0]], 1: sqls[parts[1]]}  # both analysts are visible
    assert_orders_untouched(settings, loaded_chat)

    script_happy_path(fake_model, sql="SELECT count(*) AS n FROM orders")
    assert names(ask(loaded_chat, "how many orders"))[-1] == "answer"
    assert [t["question"] for t in client.get(f"/chats/{loaded_chat}").json()["transcript"]] == [
        "drop it and count", "how many orders"
    ]

