import dataclasses

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    return dataclasses.replace(Settings.from_env(), upload_dir=str(tmp_path / "uploads"))


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def chat_id(client) -> str:
    return client.post("/chats").json()["id"]
