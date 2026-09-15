#!/usr/bin/env bash
# Nightly Saliminn database backup, driven by saliminn-backup.timer.
#
# Before this existed, backups only ran inside the deploy sequence and lived
# on the same host filesystem as Postgres — so between deploys there was no
# recovery point at all. This keeps a rolling window of verified dumps under
# /opt/saliminn/backups, plus a tar.gz of the upload trees (eKYC identity
# images, payment receipts, room-type photos) that pg_dump cannot cover.
# Off-host shipping/encryption remains a manual step
# (see docs/guides/deployment.md); until it exists, these dumps are the
# recovery point of last resort.
#
# For whoever picks that up: the tooling is already on this host and does not
# need to be built. `age`, `rclone` and `aws` are installed, and the
# online-shopping stack ships encrypted dumps nightly with them — see
# /opt/online-shopping/backup.sh, which streams pg_dump through `age` so a
# plaintext dump never touches disk, uploads with `rclone copy`, verifies a
# sha256 sidecar, and prunes daily/weekly tiers remotely. The one thing that is
# decided by the operator is the destination: the only configured rclone
# remote on the host points at another business's bucket, and hotel dumps
# carry guest PII and payment records, so they need their own bucket/prefix
# and access list. The mechanism IS wired: set SALIMINN_OFFSITE_REMOTE to an
# rclone `remote:path` and SALIMINN_AGE_RECIPIENTS_FILE to an age recipients
# file and every artifact is age-encrypted, shipped with `rclone copy`, and
# verified with `rclone check`. Without both variables nothing ships and
# `offsite` stays false so the health check can tighten once it is on.
#
# archive_mode is also off, so there is no PITR: the recovery point is the last
# nightly. Measured 2026-09-15, restoring the newest nightly would have lost
# 4 bookings, 10 payments, 3 invoices and 47 audit rows.
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
# saliminn-backup-health.timer has something machine-readable to alert on; a
# nightly backup nobody checks is indistinguishable from no backup at all.
set -euo pipefail

# SALIMINN_BACKUP_DIR / SALIMINN_SKIP_DUMP exist so the retention logic can be
# exercised against a scratch directory without touching production, matching the
# override convention the online-shopping backup scripts on this host already use.
readonly BACKUP_DIR=${SALIMINN_BACKUP_DIR:-/opt/saliminn/backups}
readonly UPLOADS_DIR=${SALIMINN_UPLOADS_DIR:-/opt/saliminn/data}
readonly NIGHTLY_RETENTION=${SALIMINN_NIGHTLY_RETENTION:-14}
readonly PREDEPLOY_RETENTION=${SALIMINN_PREDEPLOY_RETENTION:-5}
readonly UPLOADS_RETENTION=${SALIMINN_UPLOADS_RETENTION:-7}
readonly OFFSITE_REMOTE=${SALIMINN_OFFSITE_REMOTE:-}
readonly AGE_RECIPIENTS_FILE=${SALIMINN_AGE_RECIPIENTS_FILE:-}
readonly STATUS_FILE="$BACKUP_DIR/backup-status.json"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$BACKUP_DIR/nightly-$timestamp.dump"

install -d -m 0700 "$BACKUP_DIR"

# $1 = status (ok|error), $2 = error_category (empty when ok), $3 = message,
# $4 = filename (empty on failure), $5 = size bytes (0 on failure),
# $6 = offsite flag (default false).
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
  "offsite": ${6:-false}
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
elif docker exec saliminn-db \
    pg_dump --format=custom --no-owner --no-acl -U hotel_admin hotel_management \
    > "$backup_tmp" \
    && docker exec -i saliminn-db pg_restore --list < "$backup_tmp" >/dev/null; then
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

# Uploads are a second, independent data-loss class: pg_dump never covers them.
# private_uploads holds eKYC identity images and payment receipts — the
# regulated evidence behind verified bookings — and uploads holds room-type
# photos. On failure the run must still report the database dump as fresh
# (write ok first) and only then flip status to error so the health check
# pages without the "stale backup" branch masking the real cause.
uploads_failed=""
if [ -d "$UPLOADS_DIR" ]; then
    uploads_tmp=$(mktemp "$BACKUP_DIR/.uploads.XXXXXX")
    if tar -czf "$uploads_tmp" -C "$UPLOADS_DIR" uploads private_uploads 2>/dev/null \
        && [ -s "$uploads_tmp" ]; then
        chmod 0600 "$uploads_tmp"
        mv "$uploads_tmp" "$BACKUP_DIR/uploads-$timestamp.tar.gz"
    else
        rm -f -- "$uploads_tmp"
        uploads_failed="tar of $UPLOADS_DIR failed"
    fi
else
    uploads_failed="uploads directory missing: $UPLOADS_DIR"
fi
prune_class 'uploads-*.tar.gz' "$UPLOADS_RETENTION"

backup_size=$(stat -c %s "$backup_path" 2>/dev/null || echo 0)

# Off-site shipping, opt-in: no remote configured means nothing ships and the
# status keeps reporting offsite:false. Configured means age-encrypt every
# artifact produced this run into a staging dir, rclone copy it to the remote,
# then rclone check the copy — a copy that cannot be verified is treated as
# not shipped. Like uploads_failed, a failure alerts the health check without
# lying about the local recovery point's freshness.
offsite_failed=""
if [ -n "$OFFSITE_REMOTE" ] || [ -n "$AGE_RECIPIENTS_FILE" ]; then
    if [ -z "$OFFSITE_REMOTE" ] || [ -z "$AGE_RECIPIENTS_FILE" ]; then
        offsite_failed="offsite misconfigured: SALIMINN_OFFSITE_REMOTE and SALIMINN_AGE_RECIPIENTS_FILE must be set together"
    else
        ship_dir=$(mktemp -d "$BACKUP_DIR/.offsite.XXXXXX")
        for artifact in "$BACKUP_DIR"/nightly-"$timestamp".dump \
                        "$BACKUP_DIR"/uploads-"$timestamp".tar.gz; do
            [ -f "$artifact" ] || continue
            age -R "$AGE_RECIPIENTS_FILE" -o "$ship_dir/$(basename "$artifact").age" \
                "$artifact" 2>/dev/null \
                || { offsite_failed="age encryption failed for $(basename "$artifact")"; break; }
        done
        if [ -z "$offsite_failed" ]; then
            rclone copy "$ship_dir" "$OFFSITE_REMOTE" >/dev/null 2>&1 \
                && rclone check "$ship_dir" "$OFFSITE_REMOTE" --one-way >/dev/null 2>&1 \
                || offsite_failed="rclone copy/check to $OFFSITE_REMOTE failed"
        fi
        rm -rf -- "$ship_dir"
    fi
fi

trap - ERR
if [ -n "$uploads_failed" ] || [ -n "$offsite_failed" ]; then
    write_status ok "" "database dump verified; ${uploads_failed:+uploads archive failed}${offsite_failed:+ offsite ship failed}" \
        "$(basename "$backup_path")" "$backup_size"
    write_status error \
        "$( [ -n "$uploads_failed" ] && echo uploads_failed || echo offsite_failed )" \
        "${uploads_failed:-$offsite_failed}" \
        "$(basename "$backup_path")" "$backup_size"
    printf '%s backup degraded (uploads:%s offsite:%s); database dump %s is intact\n' \
        "$(date -u +%FT%TZ)" "${uploads_failed:-ok}" "${offsite_failed:-ok}" "$(basename "$backup_path")" >&2
    exit 1
fi
write_status ok "" "nightly backup verified (database + uploads${OFFSITE_REMOTE:+, offsite})" \
    "$(basename "$backup_path")" "$backup_size" "${OFFSITE_REMOTE:+true}"

printf '%s nightly database backup complete (%s, %s bytes)\n' \
    "$(date -u +%FT%TZ)" "$(basename "$backup_path")" "$backup_size"
