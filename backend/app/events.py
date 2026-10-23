"""SSE events: `emit` for graph nodes, `format_sse` for the HTTP layer.

Events: `step` {node, message}, `sql` {sub_question, sql}, `token` {text}, `answer` {text, as_of_date, charts},
`error` {message}. Nodes call `emit` from anywhere inside a graph run, including parallel `Send` branches and
threads; the messages route turns them into `text/event-stream` frames.
"""

import json

from langgraph.config import get_stream_writer

EVENTS = ("step", "sql", "token", "answer", "error")


def emit(event: str, **data) -> None:
    """Queue an SSE event for the client (must be called inside a graph node)."""
    assert event in EVENTS, event
    get_stream_writer()({"event": event, "data": data})


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"  # default=str: Decimal, date from SQL rows
