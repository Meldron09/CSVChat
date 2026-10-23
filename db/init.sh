#!/bin/sh
# Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
# Creates the owner role (ingestion + migrations), the read-only role (SQL Analysts),
# and the `app` and `checkpoints` schemas. Per-Chat schemas are created by the backend (ADR-0002).
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v owner_pw="$DB_OWNER_PASSWORD" -v ro_pw="$DB_READONLY_PASSWORD" <<'SQL'
CREATE ROLE csvchat_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE csvchat_readonly LOGIN PASSWORD :'ro_pw';

ALTER DATABASE :"DBNAME" OWNER TO csvchat_owner;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO csvchat_owner, csvchat_readonly;

-- The read-only role gets nothing by default: not even `public`.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA app AUTHORIZATION csvchat_owner;
CREATE SCHEMA checkpoints AUTHORIZATION csvchat_owner;
SQL
