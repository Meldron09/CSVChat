"""One message at a time per Chat: a second message sent while a turn is running is refused with 409 and no turn is
lost; other Chats are unaffected. Through the HTTP API with the scripted fake model."""

import threading

from helpers import CUSTOMERS, ORDERS, names, script_happy_path, upload


def message(client, chat_id, question):
    return client.post(f"/chats/{chat_id}/messages", json={"question": question, "as_of_date": "2024-11-04"})


def test_a_second_message_to_a_busy_chat_gets_409_and_no_turn_is_lost(loaded_chat, client, ask, fake_model):
    in_synthesizer, release = threading.Event(), threading.Event()

    def slow_answer(_messages):
        in_synthesizer.set()
        assert release.wait(20)
        return "Total revenue is 60.75."

    fake_model.script("orchestrator", {"sub_questions": ["What is the total revenue?"]})
    fake_model.script("sql_analyst", {"sql": "SELECT sum(total_price) AS revenue FROM orders"})
    fake_model.script("synthesizer", slow_answer)
    first = {}
    runner = threading.Thread(target=lambda: first.update(res=message(client, loaded_chat, "first question")))
    runner.start()
    try:
        assert in_synthesizer.wait(20)  # the first turn is now mid-flight and holds the Chat
        second = message(client, loaded_chat, "second question")
        assert second.status_code == 409 and "still answering" in second.json()["detail"]
        assert fake_model.prompts("orchestrator")[-1][-1].content == "first question"  # the second never reached the model
        other = client.post("/chats").json()["id"]  # a different Chat is not blocked by it
        assert upload(client, other, ("orders.csv", ORDERS), ("customers.csv", CUSTOMERS)).status_code == 200
        script_happy_path(fake_model)
        assert names(ask(other, "unrelated question"))[-1] == "answer"
    finally:
        release.set()
        runner.join(30)

    assert "event: answer" in first["res"].text
    transcript = client.get(f"/chats/{loaded_chat}").json()["transcript"]
    assert [t["question"] for t in transcript] == ["first question"]  # exactly the running turn: nothing lost, nothing doubled

    script_happy_path(fake_model)  # the lock was released: the Chat accepts the next message
    assert names(ask(loaded_chat, "second question, again"))[-1] == "answer"
    assert [t["question"] for t in client.get(f"/chats/{loaded_chat}").json()["transcript"]] == ["first question", "second question, again"]


def test_a_failed_turn_releases_the_chat(loaded_chat, client, ask, fake_model):
    fake_model.script("orchestrator", RuntimeError("boom"))
    assert names(ask(loaded_chat, "doomed"))[-1] == "error"
    script_happy_path(fake_model)
    assert names(ask(loaded_chat, "next"))[-1] == "answer"
