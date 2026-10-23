"""Ingestion: one CSV stream + a Chat's schema in, one Table loaded and a Cleaning Report out.

Keeps the raw upload on disk, sniffs encoding (UTF-8, Latin-1 fallback) and delimiter, then makes two
chunked passes (100k rows each): pass 1 infers column types, pass 2 cleans, dedups and bulk-loads with COPY.
Outliers are flagged in SQL after the load and never dropped. Memory stays bounded by the chunk size plus
8 bytes per distinct row (dedup hashes).

Nulls: an empty cell is NULL in every column. The tokens NA/N/A/nan/null/none are NULL markers only in columns that
infer to a non-text type (so `City = "None"` or a surname "Null" survive in text columns); each such conversion is
counted per column in the Cleaning Report (`null_tokens_converted`). A column whose only non-empty values are such
tokens stays text.
"""

import codecs
import csv
import io
import os
import re
from pathlib import Path
from typing import BinaryIO

import numpy as np
import pandas as pd
import psycopg
from psycopg import sql

from app.settings import Settings

CHUNK_ROWS = 100_000
NULL_TOKENS = {"na", "n/a", "nan", "null", "none"}  # NULL markers in non-text columns only (see module docstring)
NON_POSITIVE_COLUMNS = re.compile(r"price|amount|cost|total|quantity|qty")  # values <= 0 are suspicious here
SQL_TYPES = ("bigint", "numeric", "date", "timestamp")  # inference order; anything else is text
TYPE_PATTERNS = {
    "bigint": re.compile(r"[+-]?(0|[1-9]\d{0,17})"),
    "numeric": re.compile(r"[+-]?((0|[1-9]\d*)(\.\d+)?|\.\d+)"),  # leading zeros without a dot stay text (zip codes)
    "date": re.compile(r"\d{4}-\d{2}-\d{2}"),
    "timestamp": re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?"),
}


DUPLICATES_BASIS = "exact duplicates after trimming and collapsing whitespace (rows differing only in spacing count as duplicates)"


class IngestionError(Exception):
    """A user-facing rejection; `status` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def ingest(settings: Settings, chat_id: str, schema: str, filename: str, stream: BinaryIO) -> dict:
    if not filename.lower().endswith(".csv"):
        raise IngestionError(415, f"{filename}: not a CSV file (expected a .csv file)")
    table = _identifier(Path(filename).stem, "table")
    raw_dir = Path(settings.upload_dir) / chat_id
    raw_dir.mkdir(parents=True, exist_ok=True)
    part = raw_dir / f"{table}.csv.part"
    try:
        encoding = _save_raw(stream, part, settings.max_upload_bytes, filename)
        report = _load(settings, schema, table, filename, part, encoding)
        os.replace(part, raw_dir / f"{table}.csv")
        return report
    finally:
        part.unlink(missing_ok=True)


def _identifier(name: str, fallback: str) -> str:
    ident = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")[:50]
    return f"{fallback}_{ident}" if not ident or ident[0].isdigit() else ident


def _save_raw(stream: BinaryIO, path: Path, max_bytes: int, filename: str) -> str:
    """Copy the upload to disk in blocks, enforcing the size cap; returns 'utf-8-sig' or 'latin-1'."""
    decoder = codecs.getincrementaldecoder("utf-8-sig")()
    encoding, size = "utf-8-sig", 0
    with open(path, "wb") as out:
        while block := stream.read(1 << 20):
            size += len(block)
            if size > max_bytes:
                raise IngestionError(413, f"{filename}: larger than the {max_bytes // (1024 * 1024)}MB limit")
            if size == len(block) and b"\0" in block:
                raise IngestionError(415, f"{filename}: not a text CSV file (binary content)")
            out.write(block)
            if encoding == "utf-8-sig":
                try:
                    decoder.decode(block)
                except UnicodeDecodeError:
                    encoding = "latin-1"
    if size == 0:
        raise IngestionError(422, f"{filename}: file is empty")
    return encoding


def _sniff_delimiter(path: Path, encoding: str) -> str:
    with open(path, encoding=encoding, newline="") as f:
        sample = f.read(1 << 16)
    best, best_score = ",", 0
    for delim in ",;\t|":
        counts = [len(r) for r in list(csv.reader(io.StringIO(sample), delimiter=delim))[:20] if r]
        if len(counts) > 1:
            counts = counts[:-1] if len(sample) == 1 << 16 else counts  # last row may be cut off
        if counts and min(counts) > 1 and len(set(counts)) == 1 and counts[0] > best_score:
            best, best_score = delim, counts[0]
    return best


def _clean(chunk: pd.DataFrame, token_columns: list[str] | None = None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Trim and whitespace-normalize every cell; empty cells become NULL, and so do NULL_TOKENS in `token_columns`
    (default: every column). Returns (cleaned, trimmed-mask, converted-token-mask)."""
    normalized = chunk.apply(lambda col: col.str.strip().str.replace(r"\s+", " ", regex=True))
    tokens = normalized.apply(lambda col: col.str.lower().isin(NULL_TOKENS)).astype(bool)
    if token_columns is not None:
        tokens[[c for c in tokens.columns if c not in token_columns]] = False
    cleaned = normalized.mask(tokens | (normalized == ""))
    trimmed = cleaned.notna() & (cleaned != chunk)
    return cleaned, trimmed, tokens


def _chunks(path: Path, delimiter: str, encoding: str):
    return pd.read_csv(
        path, sep=delimiter, encoding=encoding, dtype=str, keep_default_na=False, chunksize=CHUNK_ROWS,
        quotechar='"', on_bad_lines="error",
    )


def _infer_types(path: Path, delimiter: str, encoding: str, columns: list[str]) -> list[str]:
    possible = {c: list(SQL_TYPES) for c in columns}
    has_value = dict.fromkeys(columns, False)  # a non-null cell, token markers aside
    has_token = dict.fromkeys(columns, False)
    for chunk in _chunks(path, delimiter, encoding):
        chunk.columns = columns
        cleaned, _, tokens = _clean(chunk)
        for col in columns:
            values = cleaned[col].dropna()
            has_value[col] |= not values.empty
            has_token[col] |= bool(tokens[col].any())
            for t in list(possible[col]):
                if values.empty:
                    break
                ok = values.str.fullmatch(TYPE_PATTERNS[t]).all()
                if ok and t == "date":
                    ok = pd.to_datetime(values, format="%Y-%m-%d", errors="coerce").notna().all()
                elif ok and t == "timestamp":
                    ok = pd.to_datetime(values, format="ISO8601", errors="coerce").notna().all()
                if not ok:
                    possible[col].remove(t)
    # only tokens ("None" in every row): that is text, not a numeric column of nulls
    return ["text" if has_token[c] and not has_value[c] else (possible[c] or ["text"])[0] for c in columns]


def _load(settings: Settings, schema: str, table: str, filename: str, path: Path, encoding: str) -> dict:
    delimiter = _sniff_delimiter(path, encoding)
    try:
        header = list(pd.read_csv(path, sep=delimiter, encoding=encoding, nrows=0, dtype=str).columns)
        columns = _unique([_identifier(str(h), "col") for h in header])
        types = _infer_types(path, delimiter, encoding, columns)
        return _copy(settings, schema, table, filename, path, delimiter, encoding, header, columns, types)
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as e:
        raise IngestionError(422, f"{filename}: could not parse as CSV ({e})") from e


def _unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for n in names:
        seen[n] = seen.get(n, 0) + 1
        out.append(n if seen[n] == 1 else f"{n}_{seen[n]}")
    return out


def _copy(settings, schema, table, filename, path, delimiter, encoding, header, columns, types) -> dict:
    tbl = sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(table))
    coldefs = sql.SQL(", ").join(sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL(t)) for c, t in zip(columns, types))
    seen = np.empty(0, dtype=np.uint64)  # sorted hashes of kept rows: exact-duplicate detection across chunks
    rows_read = loaded = 0
    nulls, trims, converted = (pd.Series(0, index=columns) for _ in range(3))
    token_columns = [c for c, t in zip(columns, types) if t != "text"]
    with psycopg.connect(settings.owner_dsn) as conn:  # one transaction: a failed load keeps the old Table
        replaced = conn.execute("SELECT to_regclass(format('%%I.%%I', %s::text, %s::text)) IS NOT NULL", (schema, table)).fetchone()[0]
        conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(tbl))
        conn.execute(sql.SQL("CREATE TABLE {} ({})").format(tbl, coldefs))
        with conn.cursor().copy(sql.SQL("COPY {} FROM STDIN WITH (FORMAT csv)").format(tbl)) as copy:
            for chunk in _chunks(path, delimiter, encoding):
                chunk.columns = columns
                rows_read += len(chunk)
                cleaned, trimmed, tokens = _clean(chunk, token_columns)
                hashes = pd.util.hash_pandas_object(cleaned, index=False).to_numpy()
                at = np.minimum(np.searchsorted(seen, hashes), max(len(seen) - 1, 0))
                seen_before = (seen[at] == hashes) if len(seen) else np.zeros(len(hashes), dtype=bool)
                keep = ~(pd.Series(hashes).duplicated().to_numpy() | seen_before)
                seen = np.sort(np.concatenate([seen, hashes[keep]]))
                cleaned = cleaned[keep]
                loaded += len(cleaned)
                nulls += cleaned.isna().sum()
                trims += trimmed[keep].sum()
                converted += tokens[keep].sum()
                copy.write(cleaned.to_csv(index=False, header=False, na_rep="").encode())
        if loaded == 0:
            raise IngestionError(422, f"{filename}: no data rows")
        outliers = _flag_outliers(conn, tbl, columns, types)
    return {
        "table": table,
        "filename": filename,
        "replaced": bool(replaced),
        "encoding": "utf-8" if encoding == "utf-8-sig" else "latin-1",
        "delimiter": delimiter,
        "rows_read": rows_read,
        "duplicates_removed": rows_read - loaded,
        "duplicates_basis": DUPLICATES_BASIS,
        "rows_loaded": loaded,
        "columns": [
            {"name": c, "original_name": h, "type": t, "nulls": int(nulls[c]), "null_tokens_converted": int(converted[c]), "values_trimmed": int(trims[c])}
            for c, h, t in zip(columns, header, types)
        ],
        "outliers": outliers,  # flagged only: no row is ever removed for being an outlier
    }


def _flag_outliers(conn: psycopg.Connection, tbl: sql.Composable, columns: list[str], types: list[str]) -> list[dict]:
    """Per numeric column: IQR outliers (1.5x fences) and, for price-like columns, values <= 0. Counted in SQL."""
    flags = []
    for col, t in zip(columns, types):
        if t not in ("bigint", "numeric"):
            continue
        c = sql.Identifier(col)
        # q3 = q1 would make a zero-width fence that flags every differing value, so no IQR rule then.
        lo, hi, n_iqr, n_non_positive = conn.execute(
            sql.SQL(
                "WITH csvchat_bounds AS (SELECT q1 - 1.5 * (q3 - q1) AS lo, q3 + 1.5 * (q3 - q1) AS hi, q3 > q1 AS spread FROM ("
                "SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY {c}) AS q1, "
                "percentile_cont(0.75) WITHIN GROUP (ORDER BY {c}) AS q3 FROM {t}) q) "
                "SELECT lo, hi, count(*) FILTER (WHERE spread AND ({c} < lo OR {c} > hi)), count(*) FILTER (WHERE {c} <= 0) "
                "FROM {t}, csvchat_bounds GROUP BY lo, hi"
            ).format(c=c, t=tbl)
        ).fetchone()
        for rule, count, where, params in (
            ("iqr", n_iqr, sql.SQL("{c} < %s OR {c} > %s").format(c=c), (lo, hi)),
            ("non_positive", n_non_positive if NON_POSITIVE_COLUMNS.search(col) else 0, sql.SQL("{c} <= 0").format(c=c), ()),
        ):
            if not count:
                continue
            samples = conn.execute(
                sql.SQL("SELECT to_jsonb(x) FROM {t} x WHERE {w} ORDER BY {c} LIMIT 5").format(t=tbl, w=where, c=c), params
            ).fetchall()
            entry = {"column": col, "rule": rule, "count": count, "samples": [r[0] for r in samples]}
            if rule == "iqr":
                entry.update(lower=lo, upper=hi)
            flags.append(entry)
    return flags
