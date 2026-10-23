# Backend

FastAPI service on Python 3.12, managed with `uv`.

## Tests

Tests run on the host against the compose Postgres (real database, no mocks). One command from the repo root:

```sh
make test
```

which is `docker compose up -d --wait db` followed by `cd backend && uv run pytest`.

The DB connection is read from env, so a checkout running its own stack just sets the same variables as for compose:

| Variable | Default | Meaning |
| --- | --- | --- |
| `POSTGRES_PORT` | `55432` | host port of the compose Postgres (also what pytest connects to) |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `DB_OWNER_PASSWORD` / `DB_READONLY_PASSWORD` | `owner` / `readonly` | role passwords (dev defaults) |
| `OLLAMA_MODEL` / `OLLAMA_BASE_URL` | `gpt-oss:20b-cloud` / `http://localhost:11434` | the chat model (`host.docker.internal` inside compose) |

`BACKEND_PORT`, `FRONTEND_PORT` and `COMPOSE_PROJECT_NAME` control the other host ports and the compose project name, so several checkouts can run concurrently, e.g.
`COMPOSE_PROJECT_NAME=csvchat2 POSTGRES_PORT=55433 BACKEND_PORT=8001 FRONTEND_PORT=3001 make test`.

Roles and the `app` / `checkpoints` schemas are created by `db/init.sh` only on a fresh volume; after changing it run `docker compose down -v`.

## Model

The chat model is built in one place, `app/model.py:build_model`, and `create_app(model_factory=...)` lets tests substitute a scripted fake.

## Ingestion

`POST /chats/{id}/files` (multipart: `files` one or more `.csv`, optional `dataset_notes`) blocks until every file is cleaned and loaded; see `app/ingestion.py`. Errors: 404 unknown Chat, 415 non-CSV, 413 over `MAX_UPLOAD_BYTES` (default 200MB), 422 empty/unparseable. The raw upload is kept untouched in `UPLOAD_DIR/<chat id>/<table>.csv` (compose volume `uploads`). The sample-dataset test reads `ONLINE_SHOP_DIR` (skipped if the directory is missing).
