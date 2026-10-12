#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ ${HOTEL_PRIVILEGE_TEST:-} == 1 ]] \
  || fail 'set HOTEL_PRIVILEGE_TEST=1 to confirm DATABASE_URL points to a disposable PostgreSQL test server'
[[ -n ${DATABASE_URL:-} ]] || fail 'DATABASE_URL must be an administrative connection to a disposable PostgreSQL server'
command -v psql >/dev/null 2>&1 || fail 'psql is required'
command -v cargo >/dev/null 2>&1 || fail 'cargo is required'
command -v openssl >/dev/null 2>&1 || fail 'openssl is required'
command -v python3 >/dev/null 2>&1 || fail 'python3 is required'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/../.." && pwd -P)

# Keep the caller's host, port, user, password, and TLS options while selecting
# an isolated disposable database.
test_database="hotel_privileges_${$}_$(openssl rand -hex 4)"
test_database_url=$(python3 - "$DATABASE_URL" "$test_database" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit

url = urlsplit(sys.argv[1])
if url.scheme not in ("postgres", "postgresql") or not url.netloc:
    raise SystemExit("DATABASE_URL must be a PostgreSQL URI")
print(urlunsplit((url.scheme, url.netloc, "/" + sys.argv[2], url.query, url.fragment)))
PY
) || fail 'could not derive an isolated test database URL'

created_database=false
cleanup() {
  if "$created_database"; then
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS $test_database WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $test_database"
created_database=true

psql "$test_database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql"
psql "$test_database_url" -X -v ON_ERROR_STOP=1 \
  -f "$repo_root/hotel-app-be/database/postgres/seed.sql"
DATABASE_URL="$test_database_url" \
  "$repo_root/hotel-app-be/database/postgres/apply-patches.sh" >/dev/null

runtime_password=$(openssl rand -hex 32)
{
  cat "$repo_root/deploy/db-least-privilege.sql"
  printf "ALTER ROLE hotel_app PASSWORD '%s';\n" "$runtime_password"
} | psql "$test_database_url" -X -v ON_ERROR_STOP=1 >/dev/null

runtime_database_url=$(python3 - "$test_database_url" "$runtime_password" <<'PY'
import sys
from urllib.parse import quote, urlsplit, urlunsplit

url = urlsplit(sys.argv[1])
userinfo = url.netloc.rsplit("@", 1)
credentials = f"hotel_app:{quote(sys.argv[2], safe='')}"
netloc = credentials + "@" + userinfo[-1]
print(urlunsplit((url.scheme, netloc, url.path, url.query, url.fragment)))
PY
) || fail 'could not derive the runtime-role test URL'

psql "$runtime_database_url" -X -v ON_ERROR_STOP=1 \
  -f "$script_dir/runtime-privileges.sql" >/dev/null

cd "$repo_root/hotel-app-be"
DATABASE_URL="$runtime_database_url" cargo test --all-features --test data_transfer_import
DATABASE_URL="$runtime_database_url" cargo test --all-features --test data_transfer_backup_v1 -- \
  --skip cancelled_import_admission_releases_slot_and_rolls_back_its_writes \
  --skip bytea_and_friends_round_trip_through_pipeline_primitives
