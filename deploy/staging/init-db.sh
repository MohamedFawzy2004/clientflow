#!/bin/sh
# Runs once, when the staging database volume is first created. The app connects as
# clientflow_app, which owns its database but is NOT a superuser (risk O2).
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -v app_password="$STAGING_APP_DB_PASSWORD" <<'SQL'
CREATE ROLE clientflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE clientflow_staging OWNER clientflow_app;
CREATE DATABASE clientflow_staging_restore OWNER clientflow_app;
REVOKE ALL ON DATABASE clientflow_staging FROM PUBLIC;
REVOKE ALL ON DATABASE clientflow_staging_restore FROM PUBLIC;
SQL
