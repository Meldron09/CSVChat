"""Ingestion through the HTTP API against the compose Postgres: upload CSVs, assert Cleaning Reports and Tables."""

import dataclasses
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from helpers import FIXTURES, SAMPLE_DIR, SAMPLE_ROWS, csv, upload

from app.main import create_app


def test_dirty_csv_is_cleaned_and_flagged(client, query, chat_id):
    res = upload(client, chat_id, ("dirty.csv", FIXTURES / "dirty.csv"), notes="Revenue = sum of price")
    assert res.status_code == 200
    report = res.json()["reports"][0]
    assert report["table"] == "dirty"
    assert (report["rows_read"], report["duplicates_removed"], report["rows_loaded"]) == (13, 2, 11)
    cols = {c["name"]: c for c in report["columns"]}
    assert cols["customer_name"]["original_name"] == "Customer Name"
    assert {n: c["type"] for n, c in cols.items()} == {
        "id": "bigint", "customer_name": "text", "city": "text", "price": "numeric", "qty": "bigint", "signup": "date",
    }
    assert (cols["city"]["nulls"], cols["price"]["nulls"], cols["signup"]["nulls"]) == (0, 1, 1)  # empty cells kept as NULL, not filled
    assert "whitespace" in report["duplicates_basis"]  # rows differing only in spacing (Alice) count as duplicates
    assert cols["city"]["values_trimmed"] == 2
    flags = {(o["column"], o["rule"]): o for o in report["outliers"]}
    assert flags[("price", "iqr")]["count"] == 2  # 9999.00 and 0.00
    assert flags[("price", "non_positive")]["count"] == 1
    assert 9999 in [s["price"] for s in flags[("price", "iqr")]["samples"]]
    assert ("qty", "iqr") not in flags

    # flagged, never dropped; text normalized; nulls are NULLs
    assert query(chat_id, "SELECT count(*) FROM dirty WHERE price IN (9999, 0)") == [(2,)]
    assert query(chat_id, "SELECT city FROM dirty WHERE id IN (1, 3) ORDER BY id") == [("Paris",), ("New York",)]
    assert query(chat_id, "SELECT city FROM dirty WHERE id = 6") == [("N/A",)]  # real text in a text column is not a null marker
    assert query(chat_id, "SELECT count(*) FROM dirty WHERE price IS NULL AND id = 7") == [(1,)]
    assert client.get(f"/chats/{chat_id}").json()["dataset_notes"] == "Revenue = sum of price"


def test_null_tokens_are_nulls_only_outside_text_columns_and_are_counted_separately(client, query, chat_id):
    body = csv(
        ("id", "name", "qty", "seen_on", "status"),
        (1, "None", 5, "2024-01-01", "None"),
        (2, "Null", "N/A", "2024-01-02", "None"),
        (3, "Bob", "nan", "null", "None"),
        (4, "NA", 7, "2024-01-04", "None"),
        (5, "", 8, "", "None"),
    )
    report = upload(client, chat_id, ("tokens.csv", body)).json()["reports"][0]
    cols = {c["name"]: c for c in report["columns"]}
    assert {n: c["type"] for n, c in cols.items()} == {"id": "bigint", "name": "text", "qty": "bigint", "seen_on": "date", "status": "text"}
    # text columns: only the truly empty cell is NULL; "None"/"Null"/"NA" are values and are kept as written
    assert (cols["name"]["nulls"], cols["name"]["null_tokens_converted"]) == (1, 0)
    assert (cols["status"]["nulls"], cols["status"]["null_tokens_converted"]) == (0, 0)  # only tokens: still text
    # typed columns: tokens become NULL and are reported apart from genuinely empty cells
    assert (cols["qty"]["nulls"], cols["qty"]["null_tokens_converted"]) == (2, 2)
    assert (cols["seen_on"]["nulls"], cols["seen_on"]["null_tokens_converted"]) == (2, 1)
    assert query(chat_id, "SELECT name, status FROM tokens ORDER BY id") == [("None", "None"), ("Null", "None"), ("Bob", "None"), ("NA", "None"), (None, "None")]
    assert query(chat_id, "SELECT qty FROM tokens ORDER BY id") == [(5,), (None,), (None,), (7,), (8,)]


def test_latin1_semicolon_file_loads(client, query, chat_id):
    report = upload(client, chat_id, ("latin1_semicolon.csv", FIXTURES / "latin1_semicolon.csv")).json()["reports"][0]
    assert (report["encoding"], report["delimiter"], report["rows_loaded"]) == ("latin-1", ";", 3)
    assert query(chat_id, "SELECT nom, ville, montant FROM latin1_semicolon ORDER BY id")[0] == ("José", "Zürich", 1.5)


def test_reupload_replaces_the_table_and_its_report(client, query, chat_id):
    upload(client, chat_id, ("t.csv", b"a,b\n1,x\n2,y\n3,z\n"))
    second = upload(client, chat_id, ("T.CSV", b"a,b\n7,q\n"))  # same Table name, different case
    assert second.json()["reports"][0]["replaced"] is True
    assert query(chat_id, "SELECT a, b FROM t") == [(7, "q")]
    stored = client.get(f"/chats/{chat_id}").json()["cleaning_reports"]
    assert [(r["table"], r["rows_loaded"]) for r in stored] == [("t", 1)]


def test_a_rejected_file_still_returns_the_reports_of_the_files_loaded_before_it(client, chat_id):
    res = upload(client, chat_id, ("good.csv", b"a,b\n1,x\n2,y\n"), ("bad.csv", b""), ("never.csv", b"c\n1\n"))
    assert res.status_code == 422 and "bad.csv" in res.json()["detail"]
    body = res.json()
    assert [r["table"] for r in body["reports"]] == ["good"] and body["reports"][0]["rows_loaded"] == 2
    assert [t["name"] for t in body["schema_profile"]["tables"]] == ["good"]  # the Dataset did change, and the client is told
    chat = client.get(f"/chats/{chat_id}").json()
    assert [r["table"] for r in chat["cleaning_reports"]] == ["good"] and chat["schema_profile"] == body["schema_profile"]


def test_files_can_be_added_later_in_a_chat(client, chat_id):
    upload(client, chat_id, ("a.csv", b"x\n1\n"))
    upload(client, chat_id, ("b.csv", b"y\n2\n"), ("c.csv", b"z\n3\n"))
    stored = client.get(f"/chats/{chat_id}").json()["cleaning_reports"]
    assert sorted(r["table"] for r in stored) == ["a", "b", "c"]


def test_tables_are_isolated_per_chat(client, query, chat_id):
    upload(client, chat_id, ("mine.csv", b"x\n1\n"))
    other = client.post("/chats").json()["id"]
    with pytest.raises(psycopg.errors.UndefinedTable):
        query(other, "SELECT * FROM mine")


def test_non_csv_is_rejected_with_415(client, chat_id):
    assert upload(client, chat_id, ("notes.txt", b"hello")).status_code == 415
    binary = upload(client, chat_id, ("fake.csv", b"\x89PNG\r\n\x1a\n\x00\x00\x00"))
    assert binary.status_code == 415 and "binary" in binary.json()["detail"]
    assert client.get(f"/chats/{chat_id}").json()["cleaning_reports"] is None  # nothing was loaded


def test_oversized_file_is_rejected_with_413(settings, tmp_path):
    small = dataclasses.replace(settings, max_upload_bytes=1000)
    with TestClient(create_app(small)) as c:
        chat = c.post("/chats").json()["id"]
        res = upload(c, chat, ("big.csv", b"a\n" + b"1\n" * 2000))
        assert res.status_code == 413 and "limit" in res.json()["detail"]
        assert not list((tmp_path / "uploads").rglob("big.csv*"))  # no partial file left behind


def test_an_oversized_request_is_refused_from_its_content_length_before_the_body_is_read(settings, tmp_path):
    small = dataclasses.replace(settings, max_request_bytes=10_000)
    with TestClient(create_app(small)) as c:
        chat = c.post("/chats").json()["id"]
        # a 5-byte body that is not even multipart: only the declared length can explain a 413 (parsing it would fail differently)
        res = c.post(
            f"/chats/{chat}/files", content=b"junk\n",
            headers={"content-type": "multipart/form-data; boundary=x", "content-length": "5000000000"},
        )
        assert res.status_code == 413 and "limit for one request" in res.json()["detail"]
        assert not (tmp_path / "uploads").exists() or not list((tmp_path / "uploads").rglob("*"))  # nothing was written
        assert upload(c, chat, ("ok.csv", b"a\n1\n")).status_code == 200  # a normal upload is unaffected


@pytest.mark.parametrize("content", [b"", b"a,b\n", b'a,b\n1,2,3,4\n"unterminated'])
def test_unparseable_files_are_422(client, chat_id, content):
    assert upload(client, chat_id, ("bad.csv", content)).status_code == 422


def test_unknown_chat_is_404(client):
    assert upload(client, str(uuid.uuid4()), ("a.csv", b"x\n1\n")).status_code == 404


def test_raw_upload_is_kept_untouched(client, settings, chat_id):
    raw = (FIXTURES / "dirty.csv").read_bytes()
    upload(client, chat_id, ("dirty.csv", raw))
    assert (Path(settings.upload_dir) / chat_id / "dirty.csv").read_bytes() == raw


def test_multi_chunk_file_dedups_across_chunk_boundaries(client, query, chat_id):
    n = 250_000  # 2.5 chunks of 100k rows
    lines = [f"{i},name {i % 7}" for i in range(n)]
    lines += [lines[5], lines[150_000], lines[10]]  # duplicates of rows in earlier chunks
    res = upload(client, chat_id, ("big.csv", ("id,name\n" + "\n".join(lines) + "\n").encode()))
    report = res.json()["reports"][0]
    assert (report["rows_read"], report["duplicates_removed"], report["rows_loaded"]) == (n + 3, 3, n)
    assert query(chat_id, "SELECT count(*), count(DISTINCT id) FROM big") == [(n, n)]


@pytest.mark.skipif(not SAMPLE_DIR.is_dir(), reason=f"sample dataset not found at {SAMPLE_DIR}; set ONLINE_SHOP_DIR")
def test_online_shop_sample_dataset(client, query, chat_id):
    res = upload(client, chat_id, *[(name, SAMPLE_DIR / name) for name in SAMPLE_ROWS])
    assert res.status_code == 200
    reports = {r["table"]: r for r in res.json()["reports"]}
    for table, rows in SAMPLE_ROWS.values():
        assert reports[table]["rows_loaded"] == rows and reports[table]["duplicates_removed"] == 0
        assert query(chat_id, f"SELECT count(*) FROM {table}") == [(rows,)]

    types = {
        (t, c): ty
        for t, c, ty in query(
            chat_id,
            "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()",
        )
    }
    assert types[("orders", "order_date")] == "date"
    assert types[("orders", "total_price")] == "numeric"
    assert types[("order_items", "quantity")] == "bigint"
    assert types[("shipments", "delivery_date")] == "date"
    assert types[("customers", "address")] == "text"

    # the two zero-price order items are flagged, and still loaded
    items = {(o["column"], o["rule"]): o for o in reports["order_items"]["outliers"]}
    flagged = items[("price_at_purchase", "non_positive")]
    assert flagged["count"] == 2
    assert sorted(s["order_item_id"] for s in flagged["samples"]) == [15001, 15002]
    assert query(chat_id, "SELECT count(*) FROM order_items WHERE price_at_purchase <= 0") == [(2,)]
    assert {o["column"] for o in reports["orders"]["outliers"]} == {"total_price"}
    assert next(o for o in reports["orders"]["outliers"])["count"] == 111
