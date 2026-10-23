"""Relationship inference and the Schema Profile through the HTTP API (real Postgres)."""

import pytest
from helpers import SAMPLE_DIR, SAMPLE_ROWS, csv, script_happy_path, upload


def edges(profile) -> set[tuple[str, str, str, str]]:
    return {(r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in profile["relationships"]}


def test_columns_that_only_share_a_name_are_not_joined(client, chat_id):
    res = upload(
        client, chat_id,
        ("a.csv", csv(("id", "city", "email", "ref"), (1, "Paris", "a1@x.com", "A1"), (2, "Paris", "a2@x.com", "A2"), (3, "Lyon", "a3@x.com", "A3"))),
        ("b.csv", csv(("id", "city", "email", "ref"), (1, "Paris", "b1@x.com", "B1"), (2, "Lyon", "b2@x.com", "B2"), (3, "Lyon", "b3@x.com", "B3"))),
    )
    # id: unique and overlapping but a plain `id` never matches by name; city: same values but not a key;
    # email/ref: unique keys with no values in common
    assert res.json()["schema_profile"]["relationships"] == []


def test_name_patterns_need_a_key_and_value_overlap(client, chat_id):
    profile = upload(
        client, chat_id,
        ("departments.csv", csv(("id", "name"), (1, "Sales"), (2, "IT"), (3, "HR"))),
        ("employees.csv", csv(("id", "name", "department_id"), (1, "Ann", 1), (2, "Bob", 1), (3, "Cy", 2), (4, "Di", 3))),
        ("contractors.csv", csv(("id", "department_id"), (1, 1), (2, 2), (3, 90), (4, 91))),  # half the values are orphans
        ("stock.csv", csv(("sku", "qty"), ("A", 5), ("B", 6), ("C", 7))),
        ("sales.csv", csv(("sale_id", "sku"), (1, "A"), (2, "A"), (3, "B"))),  # shares `sku` with stock; stock is the key side
    ).json()["schema_profile"]
    assert edges(profile) == {
        ("employees", "department_id", "departments", "id"),  # `<table>_id` -> id, singular of a plural table name
        ("sales", "sku", "stock", "sku"),  # same column name, unique on one side
    }
    by_edge = {(r["from_table"], r["to_table"]): r for r in profile["relationships"]}
    assert by_edge["employees", "departments"]["cardinality"] == "many_to_one"
    assert by_edge["sales", "stock"]["match"] == 1.0


def test_relationships_are_re_inferred_when_files_are_added_or_replaced(client, chat_id):
    orders = ("orders.csv", csv(("order_id", "customer_id"), (1, 10), (2, 11), (3, 10)))
    first = upload(client, chat_id, orders).json()["schema_profile"]
    assert first["relationships"] == [] and [t["name"] for t in first["tables"]] == ["orders"]

    added = upload(client, chat_id, ("customers.csv", csv(("customer_id", "name"), (10, "Ann"), (11, "Bob")))).json()["schema_profile"]
    assert edges(added) == {("orders", "customer_id", "customers", "customer_id")}
    assert client.get(f"/chats/{chat_id}").json()["schema_profile"] == added

    replaced = upload(client, chat_id, ("customers.csv", csv(("customer_id", "name"), (500, "Zed"), (501, "Yan")))).json()["schema_profile"]
    assert replaced["relationships"] == []  # the new customers no longer match
    assert [c["name"] for t in replaced["tables"] if t["name"] == "customers" for c in t["columns"]] == ["customer_id", "name"]


def prompt_profile(chat_id, ask, fake_model) -> str:
    """The Schema Profile text the Orchestrator was given for a question: what the agents actually see."""
    script_happy_path(fake_model)
    question = "profile please"
    ask(chat_id, question)
    prompt = fake_model.prompt_text("orchestrator")
    return prompt.split("Schema Profile:\n")[1].removesuffix("\n" + question)


def test_profile_lists_columns_types_and_samples_and_renders_for_prompts(client, chat_id, ask, fake_model):
    profile = upload(client, chat_id, ("t.csv", csv(("n", "kind", "day"), (1, "x", "2024-01-01"), (2, "x", "2024-01-02"), (3, "y", "2024-01-03"), (10, "y", "2024-01-04"), (20, "x", "2024-01-05")))).json()["schema_profile"]
    (table,) = profile["tables"]
    assert (table["name"], table["row_count"]) == ("t", 5)
    assert [(c["name"], c["type"]) for c in table["columns"]] == [("n", "bigint"), ("kind", "text"), ("day", "date")]
    assert table["columns"][1]["samples"] == ["x", "y"]  # most frequent first
    assert table["columns"][0]["samples"] == ["1", "2", "3"]  # ties in value order, not text order
    assert "kind text e.g. x | y" in prompt_profile(chat_id, ask, fake_model)


@pytest.mark.skipif(not SAMPLE_DIR.is_dir(), reason=f"sample dataset not found at {SAMPLE_DIR}; set ONLINE_SHOP_DIR")
def test_online_shop_relationships(client, chat_id, ask, fake_model):
    profile = upload(client, chat_id, *[(name, SAMPLE_DIR / name) for name in SAMPLE_ROWS]).json()["schema_profile"]
    assert edges(profile) == {  # exactly these: customers.address / suppliers.address share values but are not keys
        ("orders", "customer_id", "customers", "customer_id"),
        ("order_items", "order_id", "orders", "order_id"),
        ("order_items", "product_id", "products", "product_id"),
        ("products", "supplier_id", "suppliers", "supplier_id"),
        ("payment", "order_id", "orders", "order_id"),
        ("shipments", "order_id", "orders", "order_id"),
        ("reviews", "product_id", "products", "product_id"),
        ("reviews", "customer_id", "customers", "customer_id"),
    }
    assert {r["cardinality"] for r in profile["relationships"] if r["from_table"] in ("payment", "shipments")} == {"one_to_one"}
    assert [t["name"] for t in profile["tables"]] == sorted(t for t, _ in SAMPLE_ROWS.values())
    assert client.get(f"/chats/{chat_id}").json()["schema_profile"] == profile
    prompt = prompt_profile(chat_id, ask, fake_model)
    assert "orders.customer_id -> customers.customer_id (many-to-one, 100% of values match)" in prompt
    assert len(prompt) < 6000  # compact enough to put in every prompt
