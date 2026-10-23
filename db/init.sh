#!/bin/sh
# Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
# Creates the owner role (ingestion, migrations, and creating one read-only login role per Chat,
# hence CREATEROLE) and the `app` and `checkpoints` schemas. Per-Chat schemas and roles are
# created by the backend (ADR-0002); there is deliberately no shared read-only role.
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v owner_pw="$DB_OWNER_PASSWORD" <<'SQL'
CREATE ROLE csvchat_owner LOGIN CREATEROLE PASSWORD :'owner_pw';

ALTER DATABASE :"DBNAME" OWNER TO csvchat_owner;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO csvchat_owner;

-- Nobody gets anything by default: not even `public`.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA app AUTHORIZATION csvchat_owner;
CREATE SCHEMA checkpoints AUTHORIZATION csvchat_owner;
SQL
