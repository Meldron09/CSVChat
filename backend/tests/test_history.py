"""Resume and follow-ups: the checkpointed transcript, GET /chats/{id} after a restart, and the history window,
through the HTTP API with the scripted fake model."""

from fastapi.testclient import TestClient
from helpers import MONTHLY, NOTES, ORDERS, TOTAL, bar, names, upload

from app.main import create_app

TITLE = "Chart-title-that-only-the-spec-carries"


def script_turn(fake, sql=TOTAL, answer="Total revenue is 60.75.", sub_question="What is the total revenue?"):
    fake.script("orchestrator", {"sub_questions": [sub_question]})
    fake.script("sql_analyst", {"sql": sql})
    fake.script("synthesizer", answer)


def prompts_since(fake, before: dict, role: str) -> str:
    return "\n".join("\n".join(str(m.content) for m in call) for call in fake.prompts(role)[before[role] :])


def counts(fake) -> dict:
    return {r: len(fake.prompts(r)) for r in ("orchestrator", "sql_analyst", "chart_builder", "synthesizer")}


def test_after_a_restart_get_returns_the_full_transcript_with_chart_specs(settings, fake_model, client, loaded_chat, ask):
    fake_model.script("orchestrator", {"sub_questions": ["Revenue per month?"]})
    fake_model.script("sql_analyst", {"sql": MONTHLY})
    fake_model.script("chart_builder", {"charts": [bar(title=TITLE)]})
    fake_model.script("synthesizer", "Revenue grew every month.")
    ask(loaded_chat, "How did revenue trend?", as_of_date="2024-03-31")
    script_turn(fake_model, answer="Revenue is 60.75.")
    ask(loaded_chat, "And the total?", as_of_date="2024-04-30")
    before = client.get(f"/chats/{loaded_chat}").json()

    with TestClient(create_app(settings, model_factory=lambda _: fake_model)) as restarted:  # a fresh app on the same database
        res = restarted.get(f"/chats/{loaded_chat}")
    assert res.status_code == 200
    chat = res.json()
    assert chat == before  # nothing is lost and nothing differs
    first, second = chat["transcript"]
    assert first["question"] == "How did revenue trend?" and first["as_of_date"] == "2024-03-31"
    assert first["answer"].startswith("Revenue grew every month.") and first["queries"][0]["sql"] == MONTHLY
    assert [c["title"] for c in first["charts"]] == [TITLE] and first["charts"][0]["type"] == "bar"
    assert second["question"] == "And the total?" and second["charts"] == [] and second["queries"][0]["sql"] == TOTAL
    # the rest of the Chat comes from the Chat store
    assert chat["dataset_notes"] == NOTES and {r["table"] for r in chat["cleaning_reports"]} == {"orders", "customers"}
    assert {t["name"] for t in chat["schema_profile"]["tables"]} == {"orders", "customers"} and "relationships" in chat["schema_profile"]


def test_a_chat_with_no_turns_has_an_empty_transcript(client, chat_id):
    assert client.get(f"/chats/{chat_id}").json()["transcript"] == []


def test_a_follow_up_gets_the_previous_questions_sql_and_answer_but_no_chart_spec(loaded_chat, ask, fake_model):
    fake_model.script("orchestrator", {"sub_questions": ["Revenue per month?"]})
    fake_model.script("sql_analyst", {"sql": MONTHLY})
    fake_model.script("chart_builder", {"charts": [bar(title=TITLE)]})
    fake_model.script("synthesizer", "Revenue grew every month.")
    ask(loaded_chat, "How did revenue trend?")
    before = counts(fake_model)

    script_turn(fake_model, sql="SELECT count(*) AS n FROM orders", answer="There are 3 orders.", sub_question="Orders per month, for the same period")
    events = ask(loaded_chat, "now break it down by month")

    assert "error" not in names(events)
    for role in ("orchestrator", "sql_analyst", "synthesizer"):
        prompt = prompts_since(fake_model, before, role)
        assert "How did revenue trend?" in prompt and MONTHLY in prompt and "Revenue grew every month." in prompt, role
    for role in before:  # Chart Specs never go back to the model, in any role
        prompt = prompts_since(fake_model, before, role)
        assert TITLE not in prompt, role
    # nothing of turn 1's per-turn state leaked into turn 2
    assert events[-1][1]["charts"] == []
    assert [d["sql"] for e, d in events if e == "sql"] == ["SELECT count(*) AS n FROM orders"]


def test_only_the_last_turns_reach_the_model_while_the_transcript_keeps_all(loaded_chat, client, ask, fake_model):
    # 8 turns are asked and the window is the last 6 (README: "the model sees only the last 6 turns")
    for i in range(1, 9):
        script_turn(fake_model, sql=f"SELECT {i} AS sql_marker_{i}", answer=f"answer-marker-{i}")
        ask(loaded_chat, f"question-marker-{i}")

    for role in ("orchestrator", "sql_analyst", "synthesizer"):
        prompt = fake_model.prompt_text(role)  # the 8th turn
        for i in range(2, 8):  # turns 2..7: the last 6 before it
            assert f"question-marker-{i}" in prompt and f"sql_marker_{i}" in prompt and f"answer-marker-{i}" in prompt, (role, i)
        assert "marker-1" not in prompt and "sql_marker_1" not in prompt, role  # turn 1 has dropped out of the context
    transcript = client.get(f"/chats/{loaded_chat}").json()["transcript"]
    assert [t["question"] for t in transcript] == [f"question-marker-{i}" for i in range(1, 9)]


def test_direct_replies_are_recorded_and_remembered(client, chat_id, ask, fake_model):
    events = ask(chat_id, "What is revenue?")  # no tables uploaded: direct reply
    reply = events[-1][1]["text"]
    (turn,) = client.get(f"/chats/{chat_id}").json()["transcript"]
    assert turn["question"] == "What is revenue?" and turn["answer"] == reply and turn["queries"] == [] and turn["charts"] == []

    assert upload(client, chat_id, ("orders.csv", ORDERS)).status_code == 200
    script_turn(fake_model)
    ask(chat_id, "Total revenue please")
    assert "What is revenue?" in fake_model.prompt_text("orchestrator") and reply in fake_model.prompt_text("orchestrator")
    assert [t["question"] for t in client.get(f"/chats/{chat_id}").json()["transcript"]] == ["What is revenue?", "Total revenue please"]


def test_a_failed_turn_is_not_recorded_and_leaves_the_thread_usable(loaded_chat, client, ask, fake_model):
    script_turn(fake_model, answer="Total revenue is 60.75.")
    ask(loaded_chat, "first question")

    # fails in the Synthesizer, after the analyst results and a chart are already in the state
    fake_model.script("orchestrator", {"sub_questions": ["Revenue per month?"]})
    fake_model.script("sql_analyst", {"sql": MONTHLY})
    fake_model.script("chart_builder", {"charts": [bar(title=TITLE)]})
    fake_model.script("synthesizer", RuntimeError("model fell over"))
    events = ask(loaded_chat, "doomed question")
    assert names(events)[-1] == "error" and "model fell over" in events[-1][1]["message"]
    assert [t["question"] for t in client.get(f"/chats/{loaded_chat}").json()["transcript"]] == ["first question"]

    fake_model.script("orchestrator", {"sub_questions": ["How many orders?"]})
    fake_model.script("sql_analyst", {"sql": "SELECT count(*) AS n FROM orders"})
    fake_model.script("synthesizer", "There are 3 orders.")
    events = ask(loaded_chat, "third question")
    assert names(events)[-1] == "answer" and "error" not in names(events)
    answer = events[-1][1]
    assert answer["charts"] == [] and "There are 3 orders." in answer["text"]  # the doomed turn's chart did not leak
    transcript = client.get(f"/chats/{loaded_chat}").json()["transcript"]
    assert [t["question"] for t in transcript] == ["first question", "third question"]
    assert [q["sql"] for q in transcript[1]["queries"]] == ["SELECT count(*) AS n FROM orders"]
    assert "doomed question" not in fake_model.prompt_text("orchestrator")
