"""Schema Profile: each Table's columns, types and sample values, plus the inferred Relationships.

Relationship inference is deterministic (no LLM) and runs in SQL as the owner role:
  1. Name candidates. For a Table T with singular/plural names p, a column `<p>_id` in another Table is a child
     reference to T's key (`<p>_id`, else `id`). Other column names shared by two Tables (never plain `id`, never a
     reference some Table owns) are candidates too, with the unique side as the parent.
  2. Confirmation. The parent column must be unique (a key, so shared names like `address` are rejected), the types
     must match, and at least MIN_OVERLAP of the child's distinct values must exist in the parent.
Output is sorted, so the same Dataset always yields the same profile (and the same prompt text).
"""

import itertools

import psycopg
from psycopg import sql

from app.settings import Settings

MIN_OVERLAP = 0.9  # share of the child column's distinct values that must exist in the parent column
SAMPLE_ROWS = 10_000  # samples come from the first rows of each Table (cheap on big files)
SAMPLE_VALUES = 3
SAMPLE_WIDTH = 40


def build_profile(settings: Settings, schema: str) -> dict:
    with psycopg.connect(settings.owner_dsn) as conn:
        tables = _read_tables(conn, schema)
        return {"tables": tables, "relationships": _infer_relationships(conn, schema, tables)}


def _tbl(schema: str, table: str) -> sql.Composed:
    return sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(table))


def _read_tables(conn: psycopg.Connection, schema: str) -> list[dict]:
    columns: dict[str, list[tuple[str, str]]] = {}
    for table, column, data_type in conn.execute(
        "SELECT table_name, column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = %s ORDER BY table_name, ordinal_position",
        (schema,),
    ):
        columns.setdefault(table, []).append((column, data_type.replace(" without time zone", "")))
    return [
        {
            "name": table,
            "row_count": conn.execute(sql.SQL("SELECT count(*) FROM {}").format(_tbl(schema, table))).fetchone()[0],
            "columns": [
                {"name": c, "type": t, "samples": _samples(conn, schema, table, c)} for c, t in cols
            ],
        }
        for table, cols in sorted(columns.items())
    ]


def _samples(conn: psycopg.Connection, schema: str, table: str, column: str) -> list[str]:
    """Most frequent non-null values (ties by value) among the first rows."""
    # ponytail: first SAMPLE_ROWS rows, not a random sample; add TABLESAMPLE if Tables are sorted in a misleading way
    c = sql.Identifier(column)
    rows = conn.execute(
        sql.SQL(
            "SELECT {c}::text AS v FROM (SELECT {c} FROM {t} LIMIT {n}) s WHERE {c} IS NOT NULL "
            "GROUP BY {c} ORDER BY count(*) DESC, {c} LIMIT {k}"
        ).format(c=c, t=_tbl(schema, table), n=sql.Literal(SAMPLE_ROWS), k=sql.Literal(SAMPLE_VALUES))
    ).fetchall()
    return [r[0][:SAMPLE_WIDTH] for r in rows]


def _singular(name: str) -> str:
    if name.endswith("ies"):
        return name[:-3] + "y"
    return name[:-1] if name.endswith("s") and not name.endswith("ss") else name


def _infer_relationships(conn: psycopg.Connection, schema: str, tables: list[dict]) -> list[dict]:
    types = {t["name"]: {c["name"]: c["type"] for c in t["columns"]} for t in tables}
    counts: dict[tuple[str, str], tuple[int, int]] = {}  # (table, column) -> (non-null, distinct)

    def stats(table: str, column: str) -> tuple[int, int]:
        if (table, column) not in counts:
            c = sql.Identifier(column)
            counts[table, column] = conn.execute(
                sql.SQL("SELECT count({c}), count(DISTINCT {c}) FROM {t}").format(c=c, t=_tbl(schema, table))
            ).fetchone()
        return counts[table, column]

    def unique(table: str, column: str) -> bool:
        non_null, distinct = stats(table, column)
        return non_null > 0 and non_null == distinct

    candidates: set[tuple[str, str, str, str]] = set()  # (child table, child column, parent table, parent column)
    owned: set[str] = set()  # `<table>_id` names that belong to some Table
    for parent, parent_cols in types.items():
        for name in {parent, _singular(parent)}:
            ref = f"{name}_id"
            key = ref if ref in parent_cols else "id" if "id" in parent_cols else None
            if key is None:
                continue
            owned.add(ref)
            candidates.update((child, ref, parent, key) for child, cols in types.items() if child != parent and ref in cols)

    shared: dict[str, list[str]] = {}  # column name -> Tables having it, for names no Table owns
    for table, cols in types.items():
        for column in cols:
            if column != "id" and column not in owned:
                shared.setdefault(column, []).append(table)
    for column, names in shared.items():
        for a, b in itertools.combinations(sorted(names), 2):
            if not (unique(a, column) or unique(b, column)):
                continue
            a_is_parent = unique(a, column) and (not unique(b, column) or stats(a, column)[1] >= stats(b, column)[1])
            parent, child = (a, b) if a_is_parent else (b, a)
            candidates.add((child, column, parent, column))

    relationships = []
    for child, child_col, parent, parent_col in sorted(candidates):
        if types[child][child_col] != types[parent][parent_col] or not unique(parent, parent_col):
            continue
        n, hit = conn.execute(
            sql.SQL(
                "SELECT count(*), count(p.k) FROM (SELECT DISTINCT {cc} AS k FROM {ct} WHERE {cc} IS NOT NULL) c "
                "LEFT JOIN (SELECT {pc} AS k FROM {pt}) p ON p.k = c.k"
            ).format(
                cc=sql.Identifier(child_col), ct=_tbl(schema, child),
                pc=sql.Identifier(parent_col), pt=_tbl(schema, parent),
            )
        ).fetchone()
        if n and hit / n >= MIN_OVERLAP:
            relationships.append({
                "from_table": child, "from_column": child_col,
                "to_table": parent, "to_column": parent_col,
                "cardinality": "one_to_one" if unique(child, child_col) else "many_to_one",
                "match": round(hit / n, 3),
            })
    return relationships


def render_for_prompt(profile: dict | None) -> str:
    """Compact text form of a Schema Profile for agent prompts."""
    if not profile or not profile["tables"]:
        return "No tables uploaded."
    lines = []
    for t in profile["tables"]:
        lines.append(f"Table {t['name']} ({t['row_count']} rows)")
        for c in t["columns"]:
            lines.append(f"  {c['name']} {c['type']}" + (f" e.g. {' | '.join(c['samples'])}" if c["samples"] else ""))
    lines.append("Relationships (join on these columns):" if profile["relationships"] else "No relationships between tables.")
    for r in profile["relationships"]:
        kind = "one-to-one" if r["cardinality"] == "one_to_one" else "many-to-one"
        lines.append(
            f"  {r['from_table']}.{r['from_column']} -> {r['to_table']}.{r['to_column']} "
            f"({kind}, {r['match']:.0%} of values match)"
        )
    return "\n".join(lines)
