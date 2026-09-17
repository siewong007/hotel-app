#!/usr/bin/env bash
#
# Assert the desktop PostgreSQL bundle still matches the backend's.
#
# hotel-desktop/src-tauri/database/postgres/ is a plain copy of
# hotel-app-be/database/postgres/, produced by `bun run sync:resources`. Nothing
# else keeps the two in step: the desktop CI job compiles against PLACEHOLDER
# resources, so a schema change that lands on the backend and is never mirrored
# ships a desktop build whose database is stale — which has happened, with an
# empty patch manifest and zero patch files reaching users.
#
# Two failure modes, both silent without this check:
#   1. Drift    - a mirrored file differs, or a patch is missing/extra.
#   2. Checksum - a patch's bytes no longer hash to its manifest entry. Both
#                 executors (apply-patches.sh, src-tauri/src/postgres/patches.rs)
#                 hash raw bytes, so a CRLF checkout fails every entry and
#                 disables the whole catalog.
#
# Usage: scripts/check-desktop-db-mirror.sh   (no arguments; exit 1 on any problem)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend="$root/hotel-app-be/database/postgres"
desktop="$root/hotel-desktop/src-tauri/database/postgres"
manifest="$backend/patches/manifest.tsv"

failures=0
fail() {
    printf 'MIRROR: %s\n' "$1" >&2
    failures=$((failures + 1))
}

for dir in "$backend" "$desktop"; do
    [ -d "$dir" ] || { printf 'MIRROR: missing directory %s\n' "$dir" >&2; exit 1; }
done
[ -f "$manifest" ] || { printf 'MIRROR: missing manifest %s\n' "$manifest" >&2; exit 1; }

sha_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

# ── 1. Files that must be byte-identical on both sides ───────────────────────
# Only what the desktop bundle actually ships. Backend-only tooling
# (apply-patches.sh, staging.sql, optimization/) is deliberately not mirrored.
mirrored=(
    "migrations/0001_v1_baseline.sql"
    "seed.sql"
    "patches/manifest.tsv"
    "patches/_begin.sql"
    "patches/_end.sql"
)

# Every patch the manifest lists is mirrored too.
while IFS=$'\t' read -r _generation _version _name _checksum file; do
    case "$_generation" in ''|\#*) continue ;; esac
    [ -n "${file:-}" ] || continue
    mirrored+=("patches/$file")
done < "$manifest"

for rel in "${mirrored[@]}"; do
    a="$backend/$rel"
    b="$desktop/$rel"
    if [ ! -f "$a" ]; then fail "backend is missing $rel"; continue; fi
    if [ ! -f "$b" ]; then fail "desktop mirror is missing $rel"; continue; fi
    if ! cmp -s "$a" "$b"; then
        fail "$rel differs between backend and desktop mirror"
    fi
done

# ── 2. No unregistered or stale patch files on either side ───────────────────
registered=$(awk -F'\t' 'NF >= 5 && $1 !~ /^#/ && $1 != "" { print $5 }' "$manifest" | sort)
for side in "$backend" "$desktop"; do
    on_disk=$(find "$side/patches" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' -exec basename {} \; 2>/dev/null | sort)
    if [ "$on_disk" != "$registered" ]; then
        fail "patch files in ${side#"$root/"}/patches do not match manifest.tsv"
        diff <(printf '%s\n' "$registered") <(printf '%s\n' "$on_disk") \
            | sed 's/^/        /' >&2 || true
    fi
done

# ── 3. Desktop patch bytes must hash to their manifest entries ───────────────
# This is what src-tauri/src/postgres/patches.rs enforces at app startup; a
# mismatch there aborts the catalog and takes the desktop app offline.
while IFS=$'\t' read -r generation _version _name checksum file; do
    case "$generation" in ''|\#*) continue ;; esac
    [ -n "${file:-}" ] || continue
    target="$desktop/patches/$file"
    [ -f "$target" ] || continue   # already reported above
    actual="sha256:$(sha_of "$target")"
    if [ "$actual" != "$checksum" ]; then
        fail "checksum mismatch for desktop patches/$file"
        printf '        manifest: %s\n        actual:   %s\n' "$checksum" "$actual" >&2
    fi
done < "$manifest"

if [ "$failures" -ne 0 ]; then
    cat >&2 <<'REMEDY'

The desktop database bundle has drifted from the backend's.
Fix: run `bun run sync:resources` from hotel-desktop/, then commit the result.
Never hand-edit files under hotel-desktop/src-tauri/database/ — it is a copy.
REMEDY
    exit 1
fi

printf 'desktop DB mirror OK (%d files identical, %d patch checksums verified)\n' \
    "${#mirrored[@]}" "$(printf '%s\n' "$registered" | grep -c . || true)"
