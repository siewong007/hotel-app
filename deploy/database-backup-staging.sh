#!/usr/bin/env bash
# Nightly Saliminn database backup, driven by saliminn-staging-backup.timer.
#
# Before this existed, backups only ran inside the deploy sequence and lived
# on the same host filesystem as Postgres — so between deploys there was no
# recovery point at all. This keeps a rolling window of verified dumps under
# /opt/saliminn-staging/backups. Off-host shipping/encryption remains a manual step
# (see docs/guides/deployment.md); until it exists, these dumps are the
# recovery point of last resort.
#
# Retention is per-class on purpose. A single shared counter across nightly-*
# and predeploy-* looks conservative but is the opposite: predeploy dumps are
# written on every deploy, so a busy day evicts the nightly history that the
# counter was supposed to protect. Observed 2026-09-15 — three predeploy dumps
# in one morning had already consumed 3 of 7 slots, leaving four nights of
# history, and seven deploys in a day would have left none. Each class now
# prunes against its own counter, so deploy frequency can no longer shorten
# the nightly recovery window.
#
# Every run writes BACKUP_DIR/backup-status.json (success or failure) so
# saliminn-staging-backup-health.timer has something machine-readable to alert on; a
# nightly backup nobody checks is indistinguishable from no backup at all.
set -euo pipefail

# SALIMINN_BACKUP_DIR / SALIMINN_SKIP_DUMP exist so the retention logic can be
# exercised against a scratch directory without touching production, matching the
# override convention the online-shopping backup scripts on this host already use.
readonly BACKUP_DIR=${SALIMINN_BACKUP_DIR:-/opt/saliminn-staging/backups}
readonly NIGHTLY_RETENTION=${SALIMINN_NIGHTLY_RETENTION:-14}
readonly PREDEPLOY_RETENTION=${SALIMINN_PREDEPLOY_RETENTION:-5}
readonly STATUS_FILE="$BACKUP_DIR/backup-status.json"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$BACKUP_DIR/nightly-$timestamp.dump"

install -d -m 0700 "$BACKUP_DIR"

# $1 = status (ok|error), $2 = error_category (empty when ok), $3 = message,
# $4 = filename (empty on failure), $5 = size bytes (0 on failure).
write_status() {
    local tmp
    tmp=$(mktemp "$BACKUP_DIR/.status.XXXXXX")
    cat > "$tmp" <<STATUS
{
  "status": "$1",
  "error_category": $( [ -n "$2" ] && printf '"%s"' "$2" || printf 'null' ),
  "message": "$3",
  "last_attempt": "$(date -u +%FT%TZ)",
  "last_success": $( [ "$1" = ok ] && printf '"%s"' "$(date -u +%FT%TZ)" || {
        sed -n 's/.*"last_success": \("[^"]*"\|null\).*/\1/p' "$STATUS_FILE" 2>/dev/null | head -1 || true
    } ),
  "filename": $( [ -n "$4" ] && printf '"%s"' "$4" || printf 'null' ),
  "size_bytes": $5,
  "offsite": false
}
STATUS
    # A malformed or truncated status file must never read as a healthy backup.
    if ! grep -q '"status"' "$tmp"; then rm -f -- "$tmp"; return 0; fi
    chmod 0600 "$tmp"
    mv "$tmp" "$STATUS_FILE"
}

fail() {
    printf '%s nightly database backup FAILED (%s)\n' "$(date -u +%FT%TZ)" "$1" >&2
    write_status error "$1" "$2" "" 0
    exit 1
}

# An unexpected error (disk full mid-write, docker gone) must still leave a
# status file saying so, rather than a stale "ok" from yesterday.
trap 'rc=$?; [ $rc -ne 0 ] && write_status error unexpected "aborted with exit $rc" "" 0; exit $rc' ERR

backup_tmp=$(mktemp "$BACKUP_DIR/.nightly.XXXXXX")
if [ -n "${SALIMINN_SKIP_DUMP:-}" ]; then
    printf 'test-dump\n' > "$backup_tmp"   # retention-logic test path only
    chmod 0600 "$backup_tmp"; mv "$backup_tmp" "$backup_path"
elif docker exec saliminn-staging-db \
    pg_dump --format=custom --no-owner --no-acl -U hotel_admin hotel_management \
    > "$backup_tmp" \
    && docker exec -i saliminn-staging-db pg_restore --list < "$backup_tmp" >/dev/null; then
    chmod 0600 "$backup_tmp"
    mv "$backup_tmp" "$backup_path"
else
    rm -f -- "$backup_tmp"
    trap - ERR
    fail dump_failed "pg_dump or pg_restore --list verification failed"
fi

# Retention: prune each naming class against its own counter.
prune_class() {
    local glob=$1 keep=$2 index
    local -a files=()
    mapfile -t files < <(
        find "$BACKUP_DIR" -maxdepth 1 -type f -name "$glob" -printf '%T@ %p\n' \
            | sort -nr | cut -d' ' -f2-
    )
    for ((index = keep; index < ${#files[@]}; index++)); do
        rm -f -- "${files[$index]}"
    done
}

prune_class 'nightly-*.dump'   "$NIGHTLY_RETENTION"
prune_class 'predeploy-*.dump' "$PREDEPLOY_RETENTION"

backup_size=$(stat -c %s "$backup_path" 2>/dev/null || echo 0)
trap - ERR
write_status ok "" "nightly backup verified" "$(basename "$backup_path")" "$backup_size"

printf '%s nightly database backup complete (%s, %s bytes)\n' \
    "$(date -u +%FT%TZ)" "$(basename "$backup_path")" "$backup_size"
