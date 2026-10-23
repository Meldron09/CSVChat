import uuid

import pytest


def test_create_chat_and_reopen_it(client):
    created = client.post("/chats")
    assert created.status_code == 200
    chat_id = created.json()["id"]
    uuid.UUID(chat_id)  # a UUID

    reopened = client.get(f"/chats/{chat_id}")
    assert reopened.status_code == 200
    assert reopened.json()["id"] == chat_id


@pytest.mark.parametrize("chat_id", [str(uuid.uuid4()), "not-a-uuid"])
def test_unknown_chat_is_404(client, chat_id):
    assert client.get(f"/chats/{chat_id}").status_code == 404
