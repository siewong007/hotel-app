#!/usr/bin/env bash
#
# Backup-health consumer for the Saliminn nightly database backup.
#
# Driven by saliminn-backup-health.timer. Reads the machine-readable status file
# written by database-backup.sh and exits non-zero when the backup is NOT in a
# state a human or monitor can act on:
#
#   - status file missing or unreadable        -> "no status file"
#   - status == "error"                        -> reports error_category
#   - status == "ok" but last_success older
#     than CHECK_BACKUP_STALE_SECONDS (36h)    -> "stale backup"
#   - any other status value                   -> "unknown status"
#
# The saliminn stack had no equivalent of the online-shopping backup-health
# timer that already runs on this host, so a nightly backup could have been
# failing indefinitely with the only signal being a printf to a oneshot unit's
# stderr that nobody reads. Two off-host backup paths on this VPS have gone
# silently broken before; an unmonitored backup is assumed broken.
#
# On failure it writes a marker file containing the reason and exits 1, which is
# what a systemd OnFailure unit or external monitor keys off. On success it
# removes the marker.
#
# Optional outbound alert: create /opt/saliminn/backup-alert.env (operator-owned,
# not part of the release bundle) containing SALIMINN_ALERT_WEBHOOK=<url>. On
# every *new or changed* failure state the script POSTs {"text": ...} there —
# Slack/Discord/ntfy/webhook.site all accept that shape. Alerting on transition
# only, so the 15-minute timer does not re-notify on one persistent failure; a
# recovery message fires when a previously failed check returns healthy.
#
# Safe to run by hand:
#   /opt/saliminn/check-backup-health.sh && echo healthy || echo UNHEALTHY
#
# Env overrides (for tests): CHECK_BACKUP_STATUS_FILE, CHECK_BACKUP_STALE_SECONDS,
# CHECK_BACKUP_FAIL_MARKER, CHECK_BACKUP_NOW, CHECK_BACKUP_ALERT_ENV.
set -Eeuo pipefail

STATUS_FILE="${CHECK_BACKUP_STATUS_FILE:-/opt/saliminn/backups/backup-status.json}"
STALE_SECONDS="${CHECK_BACKUP_STALE_SECONDS:-129600}"   # 36h — one missed nightly is tolerated
FAIL_MARKER="${CHECK_BACKUP_FAIL_MARKER:-$(dirname "$STATUS_FILE")/backup-health.FAILED}"
NOW="${CHECK_BACKUP_NOW:-}"

ALERT_ENV_FILE="${CHECK_BACKUP_ALERT_ENV:-$(dirname "$STATUS_FILE")/../backup-alert.env}"
if [ -r "$ALERT_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ALERT_ENV_FILE"
fi
ALERT_WEBHOOK="${SALIMINN_ALERT_WEBHOOK:-}"

emit() { printf '[saliminn-backup-health] %s\n' "$*"; }

alert() {
    [ -n "$ALERT_WEBHOOK" ] || return 0
    command -v curl >/dev/null 2>&1 || return 0
    local text="${1//\"/\\\"}"
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
        -d "{\"text\":\"saliminn backup-health: $text\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 \
        || emit "WARNING: alert webhook POST failed"
}

unhealthy() {
    local reason="$*"
    local prev=""
    emit "CRITICAL: $reason"
    prev=$(cut -d' ' -f2- "$FAIL_MARKER" 2>/dev/null || true)
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$reason" > "$FAIL_MARKER" 2>/dev/null || true
    [ "$reason" = "$prev" ] || alert "UNHEALTHY: $reason"
    exit 1
}

# Pull one scalar out of the status JSON without a JSON parser: the file is
# written by database-backup.sh one key per line, so this stays dependency-free.
field() {
    sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$STATUS_FILE" 2>/dev/null | head -1
}

[ -r "$STATUS_FILE" ] || unhealthy "no status file at $STATUS_FILE — has the nightly backup ever run?"

status=$(field status)
[ -n "$status" ] || unhealthy "status file present but unparseable: $STATUS_FILE"

case "$status" in
    ok) ;;
    error)
        category=$(field error_category); message=$(field message)
        unhealthy "last backup FAILED (${category:-unknown}): ${message:-no detail}"
        ;;
    *)  unhealthy "unknown status value: $status" ;;
esac

last_success=$(field last_success)
[ -n "$last_success" ] || unhealthy "status is ok but last_success is missing"

if [ -n "$NOW" ]; then
    now_epoch=$(date -u -d "$NOW" +%s 2>/dev/null) || { emit "ERROR: CHECK_BACKUP_NOW is not a valid ISO timestamp: $NOW"; exit 1; }
else
    now_epoch=$(date -u +%s)
fi
success_epoch=$(date -u -d "${last_success%Z}" +%s 2>/dev/null) \
    || unhealthy "last_success is not a valid timestamp: $last_success"

age=$(( now_epoch - success_epoch ))
if [ "$age" -gt "$STALE_SECONDS" ]; then
    unhealthy "stale backup — last success $last_success is ${age}s old (threshold ${STALE_SECONDS}s)"
fi

if [ -f "$FAIL_MARKER" ]; then
    alert "RECOVERED: backup healthy — last success $last_success"
fi
rm -f -- "$FAIL_MARKER" 2>/dev/null || true
emit "healthy — last success $last_success (${age}s ago), $(field filename)"
