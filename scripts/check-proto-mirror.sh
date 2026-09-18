#!/usr/bin/env bash
#
# Assert the backend's proto mirror still matches the contract of record.
#
# proto/hotel/ is the buf-managed source of truth (lint + breaking-check in
# CI). hotel-app-be/proto/hotel/ is a plain copy the backend's build.rs
# compiles — it must live inside the crate directory because the Docker
# build context is hotel-app-be/ alone and cannot reach ../proto. Nothing
# else keeps the two in step: a contract edit that is never mirrored ships a
# server whose generated code no longer matches the reviewed contract.
#
# (hotel-app-be/proto/google/ is vendored googleapis for protoc imports; it
# has no proto/ counterpart and is intentionally not compared.)
#
# Usage: scripts/check-proto-mirror.sh   (no arguments; exit 1 on any problem)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract="$root/proto/hotel"
mirror="$root/hotel-app-be/proto/hotel"

failures=0
fail() {
    printf 'PROTO-MIRROR: %s\n' "$1" >&2
    failures=$((failures + 1))
}

for dir in "$contract" "$mirror"; do
    [ -d "$dir" ] || { printf 'PROTO-MIRROR: missing directory %s\n' "$dir" >&2; exit 1; }
done

list_files() {
    (cd "$1" && find . -name '*.proto' -type f | sort)
}

contract_files="$(list_files "$contract")"
mirror_files="$(list_files "$mirror")"

if [ "$contract_files" != "$mirror_files" ]; then
    fail "proto file sets differ (contract vs backend mirror)"
    diff <(printf '%s\n' "$contract_files") <(printf '%s\n' "$mirror_files") \
        | sed 's/^/        /' >&2 || true
fi

while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    a="$contract/$rel"
    b="$mirror/$rel"
    [ -f "$a" ] && [ -f "$b" ] || continue   # already reported above
    if ! cmp -s "$a" "$b"; then
        fail "$rel differs between proto/ and the backend mirror"
    fi
done <<< "$contract_files"

if [ "$failures" -ne 0 ]; then
    cat >&2 <<'REMEDY'

The backend proto mirror has drifted from the contract of record.
Fix: `rsync -a --delete proto/hotel/ hotel-app-be/proto/hotel/` (or
`make sync-proto`), then commit the result. Never edit files under
hotel-app-be/proto/hotel/ — they are a copy.
REMEDY
    exit 1
fi

printf 'proto mirror OK (%s files identical)\n' \
    "$(printf '%s\n' "$contract_files" | grep -c . || true)"
