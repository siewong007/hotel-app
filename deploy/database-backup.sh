#!/usr/bin/env bash
# Nightly Saliminn database backup, driven by saliminn-backup.timer.
#
# Before this existed, backups only ran inside the deploy sequence and lived
# on the same host filesystem as Postgres — so between deploys there was no
# recovery point at all. This keeps a rolling window of verified dumps under
# /opt/saliminn/backups. Off-host shipping/encryption remains a manual step
# (see docs/guides/deployment.md); until it exists, these dumps are the
# recovery point of last resort.
set -euo pipefail

readonly BACKUP_DIR=/opt/saliminn/backups
readonly RETENTION_COUNT=7

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$BACKUP_DIR/nightly-$timestamp.dump"

install -d -m 0700 "$BACKUP_DIR"

backup_tmp=$(mktemp "$BACKUP_DIR/.nightly.XXXXXX")
if docker exec saliminn-db \
    pg_dump --format=custom --no-owner --no-acl -U hotel_admin hotel_management \
    > "$backup_tmp" \
    && docker exec -i saliminn-db pg_restore --list < "$backup_tmp" >/dev/null; then
    chmod 0600 "$backup_tmp"
    mv "$backup_tmp" "$backup_path"
else
    rm -f -- "$backup_tmp"
    printf '%s nightly database backup FAILED\n' "$(date -u +%FT%TZ)" >&2
    exit 1
fi

# Retention: newest RETENTION_COUNT nightly dumps survive, across both the
# nightly-* and predeploy-* naming so one bad dump cannot wipe out history.
mapfile -t backups < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'nightly-*.dump' -o -name 'predeploy-*.dump' \) \
        -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-
)
for ((index = RETENTION_COUNT; index < ${#backups[@]}; index++)); do
    rm -f -- "${backups[$index]}"
done

printf '%s nightly database backup complete (%s)\n' "$(date -u +%FT%TZ)" "$(basename "$backup_path")"
