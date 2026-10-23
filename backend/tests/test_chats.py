import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient
from langchain_ollama import ChatOllama

from app.main import create_app
from app.model import build_model
from app.settings import Settings


@pytest.fixture(scope="module")
def settings() -> Settings:
    return Settings.from_env()  # DB connection comes from env (POSTGRES_HOST/PORT/...)


@pytest.fixture(scope="module")
def client(settings):
    with TestClient(create_app(settings)) as c:  # `with` runs the startup that creates app.chats
        yield c


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


def test_readonly_role_reads_its_chat_schema_and_nothing_else(client, settings):
    chat_id = client.post("/chats").json()["id"]
    schema = f"chat_{uuid.UUID(chat_id).hex}"
    with psycopg.connect(settings.owner_dsn, autocommit=True) as owner:
        owner.execute(f'CREATE TABLE "{schema}".t AS SELECT 1 AS x')  # stand-in for ingestion

    with psycopg.connect(settings.readonly_dsn, autocommit=True) as ro:
        ro.execute(f'SET search_path = "{schema}"')
        assert ro.execute("SELECT x FROM t").fetchone() == (1,)
        for denied in (
            "SELECT * FROM app.chats",
            "SELECT * FROM checkpoints.anything",
            "CREATE TABLE public.nope (x int)",
            "INSERT INTO t VALUES (2)",
            "DROP TABLE t",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                ro.execute(denied)


def test_model_is_built_from_env(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "some-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://example:1234")
    model = build_model(Settings.from_env())
    assert isinstance(model, ChatOllama)
    assert (model.model, model.base_url) == ("some-model", "http://example:1234")
