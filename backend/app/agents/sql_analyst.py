"""SQL Analyst: answers one sub-question with one query, run through the SQL guard."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

from app.agents.common import call_structured, dataset_context
from app.events import emit
from app.sql_guard import SqlError, run_sql
from app.state import AnalystInput, AnalystResult, Context

SYSTEM = """You are a SQL analyst. Write ONE PostgreSQL SELECT (or WITH ... SELECT) query that answers the sub-question.
Query only the Tables in the Schema Profile, with unqualified table names (no schema prefix), joining on the listed Relationships.
Read-only: never write INSERT, UPDATE, DELETE, DDL or multiple statements.
Return only the columns needed, aggregate in SQL, and keep results small.
If previous turns are shown, you may build on their SQL when the sub-question refers to them.

{context}"""


class SqlQuery(BaseModel):
    """The query to run."""

    sql: str = Field(description="A single PostgreSQL SELECT or WITH query")


MAX_RETRIES = 2


def sql_analyst(task: AnalystInput, runtime: Runtime[Context]) -> dict:
    """Ordinary database errors are fed back to the model and retried (MAX_RETRIES times), then reported as a failed
    result. SqlRejected (guard, permission denied, timeout) is terminal and propagates: the route emits an `error` event.
    All retry state is local to this call, so parallel analysts never share it."""
    ctx, sub_question = runtime.context, task["sub_question"]
    emit("step", node="sql_analyst", task=task["task"], message=f"Task {task['task'] + 1}: writing SQL for: {sub_question}")
    messages = [SystemMessage(SYSTEM.format(context=dataset_context(task))), HumanMessage(sub_question)]
    result = error = None
    for attempt in range(MAX_RETRIES + 1):
        query = call_structured(ctx.model, "sql_analyst", SqlQuery, messages)
        emit("sql", task=task["task"], sub_question=sub_question, sql=query.sql)
        try:
            result = run_sql(ctx.settings, ctx.chat_id, query.sql)
            break
        except SqlError as e:
            error = str(e)
            if attempt < MAX_RETRIES:
                emit("step", node="sql_analyst", task=task["task"], message=f"Query failed, retrying ({attempt + 1}/{MAX_RETRIES}): {error.splitlines()[0]}")
                messages = [*messages, HumanMessage(f"Your query failed.\nQuery: {query.sql}\nDatabase error: {error}\nReturn a corrected query.")]
    return {
        "results": [
            AnalystResult(
                task=task["task"],
                sub_question=sub_question,
                sql=query.sql,
                columns=result.columns if result else [],
                rows=result.rows if result else [],
                truncated=result.truncated if result else False,
                error=None if result else error,
            )
        ]
    }
