"""Shared constants and plain helpers for the API-level tests (fixtures live in conftest.py). Test files import
from here, never from each other."""

import os
import uuid
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_DIR = Path(os.environ.get("ONLINE_SHOP_DIR", Path(__file__).resolve().parents[2] / "sample-data"))  # the bundled copy
SAMPLE_ROWS = {  # file -> (table, rows)
    "customers.csv": ("customers", 10000),
    "orders.csv": ("orders", 15000),
    "order_items.csv": ("order_items", 20000),
    "products.csv": ("products", 2000),
    "payment.csv": ("payment", 15000),
    "shipments.csv": ("shipments", 15000),
    "reviews.csv": ("reviews", 1106),
    "suppliers.csv": ("suppliers", 100),
}

NOTES = "Revenue means completed payments only."
ORDERS = b"order_id,order_date,total_price\n1,2024-01-05,10.50\n2,2024-02-06,20.25\n3,2024-03-07,30.00\n"
CUSTOMERS = b"customer_id,name\n1,Ann\n2,Bob\n"
TOTAL = "SELECT sum(total_price) AS revenue FROM orders"
MONTHLY = "SELECT to_char(order_date, 'YYYY-MM') AS month, sum(total_price) AS revenue FROM orders GROUP BY 1 ORDER BY 1"


def schema_of(chat_id: str) -> str:
    return f"chat_{uuid.UUID(chat_id).hex}"


def upload(client, chat_id, *files, notes=None):
    """files: (filename, bytes-or-Path) pairs."""
    parts = [("files", (name, content.read_bytes() if isinstance(content, Path) else content)) for name, content in files]
    return client.post(f"/chats/{chat_id}/files", files=parts, data={"dataset_notes": notes} if notes else None)


def csv(*rows) -> bytes:
    return ("\n".join(",".join(map(str, r)) for r in rows) + "\n").encode()


def names(events):
    return [e for e, _ in events]


def script_happy_path(fake, sql=TOTAL, answer="Total revenue is 60.75."):
    fake.script("orchestrator", {"sub_questions": ["What is the total revenue?"]})
    fake.script("sql_analyst", {"sql": sql})
    fake.script("synthesizer", answer)


def line(**over):
    spec = {
        "type": "line",
        "title": "Monthly revenue",
        "x_key": "month",
        "x_label": "Month",
        "y_label": "Revenue",
        "series": [{"key": "revenue", "label": "Revenue"}],
        "data": [{"month": "2024-01", "revenue": 10.5}, {"month": "2024-02", "revenue": 20.25}, {"month": "2024-03", "revenue": 30}],
    }
    return {**spec, **over}


def bar(**over):
    return line(**{"type": "bar", "title": "Revenue by month", **over})


def assert_valid_stream(events):
    """step/sql events (any task order) all precede the first token; `answer` is last; exactly one terminal event."""
    kinds = names(events)
    assert kinds[-1] == "answer" and kinds.count("answer") + kinds.count("error") == 1
    first_token = kinds.index("token")
    assert {"token", "answer"}.isdisjoint(kinds[:first_token]) and "step" not in kinds[first_token:] and "sql" not in kinds[first_token:]
    assert kinds[first_token:-1] == ["token"] * (len(kinds) - first_token - 1)
