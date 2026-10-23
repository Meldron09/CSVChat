"""Shared by every agent: the one way to call the model, and the dataset context block for prompts."""

from collections.abc import Iterator
from typing import TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage
from pydantic import BaseModel

from app.state import HISTORY_TURNS, DatasetInfo, Turn

T = TypeVar("T", bound=BaseModel)


def role_config(role: str) -> dict:
    """Tag every model call with its agent role (`orchestrator`, `sql_analyst`, `synthesizer`, ...).
    Shows up in traces, and is how the scripted fake model in tests tells the roles apart."""
    return {"tags": [f"role:{role}"]}


def call_structured(model: BaseChatModel, role: str, schema: type[T], messages: list[BaseMessage]) -> T:
    """Model call returning a validated `schema` instance via tool calling.

    Tool calling, not Ollama's `format=` JSON schema: gpt-oss ignores `format` (its Harmony output format
    bypasses constrained decoding) but supports tools reliably. Ollama cannot force the tool call though, so a
    plain-text reply is retried once with a nudge before giving up.
    """
    runnable = model.with_structured_output(schema, method="function_calling")
    for _ in range(2):
        out = runnable.invoke(messages, config=role_config(role))
        if out is not None:  # None: the model answered in text instead of calling the tool
            return out
        messages = [*messages, HumanMessage(f"Respond only by calling the {schema.__name__} tool.")]
    raise ValueError(f"The model did not return a structured {schema.__name__} ({role})")


def stream_text(model: BaseChatModel, role: str, messages: list[BaseMessage]) -> Iterator[str]:
    for chunk in model.stream(messages, config=role_config(role)):
        if chunk.text:
            yield chunk.text


def render_history(turns: list[Turn]) -> str:
    """The last HISTORY_TURNS turns as prompt text: question, SQL run and answer text. Chart Specs are left out on purpose."""
    parts = []
    for i, t in enumerate(turns[-HISTORY_TURNS:], 1):
        sqls = "".join(f"\n  {q['sql']}" + (f"   -- failed: {q['error']}" if q.get("error") else "") for q in t["queries"]) or " (none)"
        parts.append(f"Turn {i}\nQuestion: {t['question']}\nSQL run:{sqls}\nAnswer: {t['answer']}")
    return "\n\n".join(parts)


def dataset_context(info: DatasetInfo) -> str:
    """The block injected into every agent prompt: As-of Date, Dataset Notes, Schema Profile, and earlier turns if any."""
    history = info.get("history")
    return (
        f"As-of Date (today for this analysis): {info['as_of_date']}\n"
        "Resolve every relative time phrase (\"past year\", \"last 6 months\", \"this month\") against the As-of Date. "
        "Never use the real current date or now()/current_date.\n\n"
        f"Dataset Notes (business definitions you must follow):\n{info['dataset_notes'] or '(none)'}\n\n"
        f"Schema Profile:\n{info['schema_profile']}"
        + (f"\n\nPrevious turns of this Chat (oldest first), for context only; the user's new question may build on them:\n{history}" if history else "")
    )
