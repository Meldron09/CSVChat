import dataclasses
import json
import uuid

import psycopg
import pytest
from fake_model import FakeChatModel
from fastapi.testclient import TestClient
from helpers import CUSTOMERS, NOTES, ORDERS, schema_of, upload

from app import chats  # DELIBERATE EXCEPTION to "drive only the HTTP API": see chat_role_connect below
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


@pytest.fixture
def loaded_chat(client, chat_id) -> str:
    """A Chat with `orders` and `customers` Tables and Dataset Notes."""
    assert upload(client, chat_id, ("orders.csv", ORDERS), ("customers.csv", CUSTOMERS), notes=NOTES).status_code == 200
    return chat_id


@pytest.fixture
def sample_chat(client, chat_id) -> str:
    """A Chat with the bundled Online Shop sample loaded through the one-click route."""
    assert client.post(f"/chats/{chat_id}/sample").status_code == 200
    return chat_id


@pytest.fixture
def chat_role_connect(settings):
    """DELIBERATE EXCEPTION to the HTTP-only rule. Isolation is a property of the database (ADR-0002), so the tests
    that prove it (test_isolation.py) and the ones that read loaded Tables back need a connection as the Chat's own
    read-only login role. This fixture, with `query`, is the only place tests build such a connection."""

    def connect(chat_id: str, login_as: str | None = None, **kw) -> psycopg.Connection:
        """Connection as the Chat's role; `login_as`: another Chat's role name with this Chat's password (must fail)."""
        dsn = chats.chat_dsn(settings, uuid.UUID(chat_id))
        if login_as:
            dsn = dsn.replace(schema_of(chat_id), schema_of(login_as))
        return psycopg.connect(dsn, **kw)

    return connect


@pytest.fixture
def query(chat_role_connect):
    """query(chat_id, statement) -> rows, read as the Chat's own role (so it also proves that role sees the Tables)."""

    def run(chat_id: str, statement: str) -> list[tuple]:
        with chat_role_connect(chat_id, autocommit=True) as ro:
            ro.execute(f'SET search_path = "{schema_of(chat_id)}"')
            return ro.execute(statement).fetchall()

    return run
