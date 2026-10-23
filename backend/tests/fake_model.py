"""Scripted fake chat model: deterministic stand-in for ChatOllama in API tests (see backend/README.md).

    fake = FakeChatModel()
    fake.script("orchestrator", {"sub_questions": ["..."]})      # structured output: dict or pydantic instance
    fake.script("sql_analyst", {"sql": "SELECT 1"})
    fake.script("synthesizer", "The answer text")                # plain text, streamed word by word
    # (a plain str scripted for a structured-output role simulates the model skipping the tool call)
    ...
    fake.prompt_text("sql_analyst")                              # everything the SQL Analyst was sent

Responses are consumed per role, in call order. A response may also be an Exception (raised by the call) or a
callable taking the messages and returning any of the above (use it when parallel calls of one role must be told
apart by their prompt). A call to a role with nothing scripted fails the test loudly (except `chart_builder`, which builds no charts).
The role of a call comes from the `role:<name>` tag set in app/agents/common.py:role_config.
"""

import json
import re
import threading
from collections import defaultdict, deque

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel, PrivateAttr


DEFAULTS = {"chart_builder": {"charts": []}}  # an unscripted Chart Builder builds no charts


class FakeChatModel(BaseChatModel):
    _scripts: dict = PrivateAttr(default_factory=lambda: defaultdict(deque))
    _prompts: dict = PrivateAttr(default_factory=lambda: defaultdict(list))
    _lock: threading.Lock = PrivateAttr(default_factory=threading.Lock)

    # --- test API ---
    def script(self, role: str, *responses) -> "FakeChatModel":
        self._scripts[role].extend(responses)
        return self

    def prompts(self, role: str) -> list[list[BaseMessage]]:
        """Every message list this role was called with, in call order."""
        return self._prompts[role]

    def prompt_text(self, role: str, call: int = -1) -> str:
        """All message contents of one call of `role`, joined (default: the last call)."""
        return "\n".join(str(m.content) for m in self._prompts[role][call])

    # --- BaseChatModel plumbing ---
    @property
    def _llm_type(self) -> str:
        return "scripted-fake"

    def bind_tools(self, tools, **kwargs):
        return self.bind(tools=tools, **kwargs)  # structured output = one forced tool call

    # The role is read from the call's config tags and handed to _generate/_stream as a private kwarg
    # (langchain-core does not pass a run manager to _stream, so it cannot be read from there).
    @staticmethod
    def _role(config) -> str:
        return next((t.removeprefix("role:") for t in (config or {}).get("tags", []) if t.startswith("role:")), "unknown")

    def invoke(self, input, config=None, **kwargs):
        return super().invoke(input, config, _role=self._role(config), **kwargs)

    def stream(self, input, config=None, **kwargs):
        return super().stream(input, config, _role=self._role(config), **kwargs)

    def _next(self, messages, kwargs):
        role = kwargs.pop("_role", "unknown")
        with self._lock:
            self._prompts[role].append(list(messages))
            if self._scripts[role]:
                item = self._scripts[role].popleft()
            elif role in DEFAULTS:  # a role that usually has nothing to do in a test answers "nothing" unless scripted
                item = DEFAULTS[role]
            else:
                raise AssertionError(f"FakeChatModel: nothing scripted for role {role!r} (call {len(self._prompts[role])})")
        if callable(item):
            item = item(messages)
        if isinstance(item, Exception):
            raise item
        if (tools := kwargs.get("tools")) and not isinstance(item, str):  # a str on a structured call = model skipped the tool
            args = item.model_dump() if isinstance(item, BaseModel) else dict(item)
            return None, {"name": convert_to_openai_tool(tools[0])["function"]["name"], "args": args}
        return str(item), None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        text, call = self._next(messages, kwargs)
        msg = AIMessage(content=text or "", tool_calls=[{**call, "id": "call_1", "type": "tool_call"}] if call else [])
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        text, call = self._next(messages, kwargs)
        if call:
            chunk = AIMessageChunk(
                content="", tool_call_chunks=[{"name": call["name"], "args": json.dumps(call["args"]), "id": "call_1", "index": 0}]
            )
            yield ChatGenerationChunk(message=chunk)
            return
        for token in re.findall(r"\S+\s*|\s+", text):  # words, trailing whitespace attached
            yield ChatGenerationChunk(message=AIMessageChunk(content=token))
