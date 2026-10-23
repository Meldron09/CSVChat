"""Chat isolation is enforced by the database (ADR-0002): each Chat's own login role sees only its own schema.

DELIBERATE EXCEPTION to "tests drive only the HTTP API": isolation is a property of Postgres, not of any endpoint,
so these tests bypass the SQL guard and talk to the database as the Chat's own role, through the `chat_role_connect`
fixture in conftest.py (the one place such connections are built). The end-to-end path through the agent is covered
over HTTP in test_sql_safety.py."""

import psycopg
import pytest

from helpers import schema_of


def new_chat_with_table(client, settings, value):
    chat_id = client.post("/chats").json()["id"]
    with psycopg.connect(settings.owner_dsn, autocommit=True) as owner:
        owner.execute(f'CREATE TABLE "{schema_of(chat_id)}".t AS SELECT {value} AS x')  # stand-in for ingestion
    return chat_id, schema_of(chat_id)


def test_a_chat_role_reads_its_own_schema_and_nothing_else(client, settings, chat_role_connect):
    mine, my_schema = new_chat_with_table(client, settings, 1)
    theirs, their_schema = new_chat_with_table(client, settings, 2)

    with chat_role_connect(mine, autocommit=True) as conn:
        assert conn.execute(f'SELECT x FROM "{my_schema}".t').fetchone() == (1,)
        for denied in (
            f'SELECT x FROM "{their_schema}".t',  # another Chat, schema-qualified
            "SELECT * FROM app.chats",
            "SELECT * FROM checkpoints.anything",
            "CREATE TABLE public.nope (x int)",
            f'CREATE TABLE "{my_schema}".nope (x int)',
            f'INSERT INTO "{my_schema}".t VALUES (2)',
            f'DROP TABLE "{my_schema}".t',
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(denied)
        # no way to become another role: there are no memberships to switch to
        for escape in (f'SET ROLE "{their_schema}"', "SET ROLE csvchat_owner", f"SELECT set_config('role', '{their_schema}', false)"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(escape)


def test_a_chat_role_cannot_connect_with_another_chats_password(client, settings, chat_role_connect):
    mine, _ = new_chat_with_table(client, settings, 1)
    theirs, _ = new_chat_with_table(client, settings, 2)
    with pytest.raises(psycopg.OperationalError):
        chat_role_connect(mine, login_as=theirs)  # their role, my password
