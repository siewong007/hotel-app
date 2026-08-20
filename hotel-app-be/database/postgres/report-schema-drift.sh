#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

case ${BASELINE_DATABASE_URL:-} in
    *[![:space:]]*) ;;
    *) fail 'BASELINE_DATABASE_URL is required' ;;
esac
case ${TARGET_DATABASE_URL:-} in
    *[![:space:]]*) ;;
    *) fail 'TARGET_DATABASE_URL is required' ;;
esac
[[ $BASELINE_DATABASE_URL != "$TARGET_DATABASE_URL" ]] \
    || fail 'baseline and target database URLs must be distinct'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
inventory_sql="$script_dir/schema-inventory.sql"
[[ -f $inventory_sql && ! -L $inventory_sql ]] || fail 'schema inventory SQL is unavailable'

umask 077
baseline_inventory=''
target_inventory=''
cleanup() {
    [[ -z $baseline_inventory ]] || rm -f -- "$baseline_inventory"
    [[ -z $target_inventory ]] || rm -f -- "$target_inventory"
}
trap cleanup EXIT
baseline_inventory=$(mktemp "${TMPDIR:-/tmp}/hotel-schema-baseline.XXXXXX") \
    || fail 'baseline inventory file cannot be created'
target_inventory=$(mktemp "${TMPDIR:-/tmp}/hotel-schema-target.XXXXXX") \
    || fail 'target inventory file cannot be created'
chmod 0600 "$baseline_inventory" "$target_inventory" \
    || fail 'schema inventory file permissions cannot be restricted'

if ! psql --dbname="$BASELINE_DATABASE_URL" -XAt -q -v ON_ERROR_STOP=1 -f "$inventory_sql" \
    > "$baseline_inventory"; then
    fail 'baseline schema inventory failed'
fi
if ! psql --dbname="$TARGET_DATABASE_URL" -XAt -q -v ON_ERROR_STOP=1 -f "$inventory_sql" \
    > "$target_inventory"; then
    fail 'target schema inventory failed'
fi

if diff -u --label baseline --label target "$baseline_inventory" "$target_inventory"; then
    exit 0
else
    diff_status=$?
fi
[[ $diff_status -ne 1 ]] || exit 2
exit "$diff_status"
