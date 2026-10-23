import dataclasses
import json

import pytest
from fake_model import FakeChatModel
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    return dataclasses.replace(Settings.from_env(), upload_dir=str(tmp_path / "uploads"))


@pytest.fixture
def fake_model() -> FakeChatModel:
    """Scripted model injected at the single model construction point; see tests/fake_model.py."""
    return FakeChatModel()


@pytest.fixture
def client(settings, fake_model):
    with TestClient(create_app(settings, model_factory=lambda _: fake_model)) as c:
        yield c


@pytest.fixture
def chat_id(client) -> str:
    return client.post("/chats").json()["id"]


@pytest.fixture
def ask(client):
    """ask(chat_id, question, as_of_date="2024-11-04") -> [(event, data), ...] from the SSE stream."""

    def ask(chat_id: str, question: str, as_of_date: str = "2024-11-04") -> list[tuple[str, dict]]:
        res = client.post(f"/chats/{chat_id}/messages", json={"question": question, "as_of_date": as_of_date})
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
        events = []
        for frame in res.text.split("\n\n"):
            if frame.strip():
                event, data = frame.split("\n")
                events.append((event.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
        return events

    return ask
