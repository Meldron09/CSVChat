"""SQL Analyst: answers one sub-question with one query, run through the SQL guard."""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from pydantic import BaseModel, Field

from app.agents.common import call_structured, dataset_context
from app.events import emit
from app.sql_guard import run_sql
from app.state import AnalystInput, Context

SYSTEM = """You are a SQL analyst. Write ONE PostgreSQL SELECT (or WITH ... SELECT) query that answers the sub-question.
Query only the Tables in the Schema Profile, with unqualified table names (no schema prefix), joining on the listed Relationships.
Read-only: never write INSERT, UPDATE, DELETE, DDL or multiple statements.
Return only the columns needed, aggregate in SQL, and keep results small.

{context}"""


class SqlQuery(BaseModel):
    """The query to run."""

    sql: str = Field(description="A single PostgreSQL SELECT or WITH query")


def sql_analyst(task: AnalystInput, runtime: Runtime[Context]) -> dict:
    ctx = runtime.context
    emit("step", node="sql_analyst", message=f"Writing SQL: {task['sub_question']}")
    query = call_structured(
        ctx.model,
        "sql_analyst",
        SqlQuery,
        [SystemMessage(SYSTEM.format(context=dataset_context(task))), HumanMessage(task["sub_question"])],
    )
    emit("sql", sub_question=task["sub_question"], sql=query.sql)
    # ticket #6: catch SqlRejected / database errors here, retry up to 2 times feeding the error back, and report failure.
    # For now they propagate and the route turns them into an `error` event.
    result = run_sql(ctx.settings, ctx.chat_id, query.sql)
    return {"results": [{"sub_question": task["sub_question"], "sql": query.sql, "columns": result.columns, "rows": result.rows}]}
