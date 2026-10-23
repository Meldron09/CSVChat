"""Chat isolation is enforced by the database (ADR-0002): each Chat's own login role sees only its own schema.
These tests bypass the SQL guard on purpose and talk to Postgres as the Chat's role."""

import uuid

import psycopg
import pytest

from app import chats


def new_chat_with_table(client, settings, value):
    chat_id = client.post("/chats").json()["id"]
    schema = chats.schema_name(uuid.UUID(chat_id))
    with psycopg.connect(settings.owner_dsn, autocommit=True) as owner:
        owner.execute(f'CREATE TABLE "{schema}".t AS SELECT {value} AS x')  # stand-in for ingestion
    return uuid.UUID(chat_id), schema


def test_a_chat_role_reads_its_own_schema_and_nothing_else(client, settings):
    mine, my_schema = new_chat_with_table(client, settings, 1)
    theirs, their_schema = new_chat_with_table(client, settings, 2)

    with psycopg.connect(chats.chat_dsn(settings, mine), autocommit=True) as conn:
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


def test_a_chat_role_cannot_connect_with_another_chats_password(client, settings):
    mine, _ = new_chat_with_table(client, settings, 1)
    theirs, their_schema = new_chat_with_table(client, settings, 2)
    wrong = chats.chat_dsn(settings, mine).replace(chats.schema_name(mine), their_schema)  # their role, my password
    with pytest.raises(psycopg.OperationalError):
        psycopg.connect(wrong)
