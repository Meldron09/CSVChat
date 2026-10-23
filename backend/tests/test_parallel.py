"""Multi-part and cross-file questions: parallel SQL Analysts and the Synthesizer's merge, through the HTTP API."""

import json
import threading
import time

import pytest
from helpers import SAMPLE_DIR, SAMPLE_ROWS, assert_valid_stream, names, upload

PARTS = ["What is the total revenue?", "How many customers are there?", "What is the largest order?"]
SQL_FOR = {
    PARTS[0]: "SELECT sum(total_price) AS revenue FROM orders",
    PARTS[1]: "SELECT count(*) AS customers FROM customers",
    PARTS[2]: "SELECT max(total_price) AS largest FROM orders",
}


def test_multi_part_question_runs_sql_analysts_in_parallel_and_the_synthesizer_merges_them(loaded_chat, ask, fake_model):
    both_running = threading.Barrier(len(PARTS), timeout=10)  # only passes if every analyst is inside its model call at once

    def analyst(messages):
        sub_question = messages[-1].content
        both_running.wait()  # BrokenBarrierError (-> `error` event) when the analysts run one after another
        if sub_question == PARTS[0]:
            time.sleep(0.3)  # the first task finishes last
        return {"sql": SQL_FOR[sub_question]}

    fake_model.script("orchestrator", {"sub_questions": PARTS})
    fake_model.script("sql_analyst", analyst, analyst, analyst)
    fake_model.script("synthesizer", "Revenue is 60.75, there are 2 customers and the largest order is 30.00.")
    events = ask(loaded_chat, "Revenue, how many customers, and the largest order?")

    assert_valid_stream(events)
    sqls = [d for e, d in events if e == "sql"]
    assert sorted((d["task"], d["sub_question"], d["sql"]) for d in sqls) == [(i, q, SQL_FOR[q]) for i, q in enumerate(PARTS)]
    steps = [d for e, d in events if e == "step" and d["node"] == "sql_analyst"]
    assert sorted(d["task"] for d in steps) == [0, 1, 2] and all(PARTS[d["task"]] in d["message"] for d in steps)
    assert len(fake_model.prompts("sql_analyst")) == len(PARTS) and len(fake_model.prompts("synthesizer")) == 1

    # the Synthesizer got every result, ordered by sub-question even though task 0 finished last
    prompt = fake_model.prompt_text("synthesizer")
    positions = [prompt.index(f'"sub_question": "{q}"') for q in PARTS]
    assert positions == sorted(positions)
    assert all(v in prompt for v in ("60.75", "[[2]]", "30.00"))
    assert events[-1][1]["text"].startswith("Revenue is 60.75, there are 2 customers")


def test_a_simple_question_runs_exactly_one_sql_analyst(loaded_chat, ask, fake_model):
    fake_model.script("orchestrator", {"sub_questions": [PARTS[0]]})
    fake_model.script("sql_analyst", {"sql": SQL_FOR[PARTS[0]]}).script("synthesizer", "Revenue is 60.75.")
    events = ask(loaded_chat, "What is the total revenue?")

    assert_valid_stream(events)
    assert len(fake_model.prompts("sql_analyst")) == 1
    assert [(d["task"], d["sub_question"]) for e, d in events if e == "sql"] == [(0, PARTS[0])]


def test_the_orchestrator_is_told_how_to_decompose_and_the_fan_out_is_capped_at_4(loaded_chat, ask, fake_model):
    too_many = [f"Part {i}?" for i in range(6)]
    fake_model.script("orchestrator", {"sub_questions": too_many})
    for _ in range(4):  # a fifth analyst would find nothing scripted and fail the stream
        fake_model.script("sql_analyst", {"sql": "SELECT 1 AS one"})
    fake_model.script("synthesizer", "ok")
    events = ask(loaded_chat, "everything")

    assert_valid_stream(events)
    assert len(fake_model.prompts("sql_analyst")) == 4
    assert sorted(d["task"] for e, d in events if e == "sql") == [0, 1, 2, 3]
    assert any("answering the first 4" in d["message"] for e, d in events if e == "step" and d["node"] == "orchestrator")
    prompt = fake_model.prompt_text("orchestrator")
    assert "ONE sub-question" in prompt and "at most 4" in prompt and "Relationships in the Schema Profile" in prompt


@pytest.mark.skipif(not SAMPLE_DIR.is_dir(), reason=f"sample dataset not found at {SAMPLE_DIR}; set ONLINE_SHOP_DIR")
def test_cross_file_question_joins_tables_through_the_inferred_relationships(client, query, chat_id, ask, fake_model):
    upload(client, chat_id, *[(name, SAMPLE_DIR / name) for name in SAMPLE_ROWS])
    sub_question = "Which 5 suppliers have the lowest average review rating on their products? Join reviews to products to suppliers."
    join = (  # lowest-rated suppliers: reviews -> products -> suppliers, through the Relationships
        "SELECT s.supplier_id, s.supplier_name, round(avg(r.rating), 2) AS avg_rating, count(*) AS reviews "
        "FROM reviews r JOIN products p ON p.product_id = r.product_id JOIN suppliers s ON s.supplier_id = p.supplier_id "
        "GROUP BY s.supplier_id, s.supplier_name ORDER BY avg_rating, reviews DESC, s.supplier_id LIMIT 5"
    )
    fake_model.script("orchestrator", {"sub_questions": [sub_question]}).script("sql_analyst", {"sql": join})
    fake_model.script("synthesizer", "Supplier lowest rated.")
    events = ask(chat_id, "Which suppliers' products got the lowest-rated reviews?")

    assert_valid_stream(events)
    for role in ("orchestrator", "sql_analyst"):  # the inferred Relationships are what the agents are given
        prompt = fake_model.prompt_text(role)
        for edge in ("reviews.product_id -> products.product_id", "products.supplier_id -> suppliers.supplier_id"):
            assert edge in prompt, (role, edge)
    assert len(fake_model.prompts("sql_analyst")) == 1

    # the join ran against the real data and returned sensible rows: ratings in 1..5, ascending, at most 5 suppliers
    expected = query(  # same question phrased differently (IN-subquery instead of joins)
        chat_id,
        "SELECT s.supplier_id, s.supplier_name, a.avg_rating, a.n FROM suppliers s JOIN ("
        " SELECT p.supplier_id, round(avg(r.rating), 2) AS avg_rating, count(*) AS n FROM reviews r, products p"
        " WHERE p.product_id = r.product_id GROUP BY p.supplier_id) a ON a.supplier_id = s.supplier_id"
        " ORDER BY a.avg_rating, a.n DESC, s.supplier_id LIMIT 5",
    )
    assert len(expected) == 5 and all(1 <= row[2] <= 5 for row in expected)
    assert [row[2] for row in expected] == sorted(row[2] for row in expected)
    assert json.dumps([list(row) for row in expected], default=str) in fake_model.prompt_text("synthesizer")


def test_one_part_failing_after_retries_still_gives_a_normal_answer_that_reports_it_next_to_the_good_part(loaded_chat, ask, fake_model):
    bad_sql = "SELECT revenue FROM orders"  # unknown column, so every attempt fails

    def analyst(messages):  # messages[1] is always the sub-question; later ones are retry feedback
        return {"sql": bad_sql if messages[1].content == PARTS[0] else SQL_FOR[PARTS[1]]}

    fake_model.script("orchestrator", {"sub_questions": PARTS[:2]})
    fake_model.script("sql_analyst", *[analyst] * 4)  # task 0: 1 attempt + 2 retries; task 1: 1 attempt
    fake_model.script("synthesizer", "There are 2 customers; the revenue part failed.")
    events = ask(loaded_chat, "Revenue and how many customers?")

    assert_valid_stream(events)
    assert "error" not in names(events) and len(fake_model.prompts("sql_analyst")) == 4
    assert sorted(d["task"] for e, d in events if e == "sql") == [0, 0, 0, 1]
    prompt = fake_model.prompt_text("synthesizer")
    failed_block = prompt.split("Failed parts:\n")[1]
    assert PARTS[0] in failed_block and 'column "revenue" does not exist' in failed_block and PARTS[1] not in failed_block
    ok_block = prompt.split("Query results:\n")[1].split("Failed parts:")[0]
    assert f'"sub_question": "{PARTS[1]}"' in ok_block and "[[2]]" in ok_block and PARTS[0] not in ok_block
