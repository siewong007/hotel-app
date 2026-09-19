#!/usr/bin/env bash
set -euo pipefail
# Signs the sidecar + bundled PostgreSQL binaries with the Developer ID
# identity. Runs BEFORE `tauri build`: the bundler copies these files into
# the .app, so they must carry a valid hardened-runtime signature beforehand
# or the outer signature/notarization fails.
#
# Two sidecar locations are signed on purpose: `desktop:prepare` (tauri's
# beforeBuildCommand) re-runs copy-backend-sidecar.mjs during `tauri build`,
# which byte-compares the cargo output against src-tauri/binaries/ and
# re-copies on any difference. Signing only the staged copy would be wiped;
# signing the cargo output too means whichever copy lands is signed.
IDENTITY="${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ROOT="$(cd "$ROOT/.." && pwd)/hotel-app-be"

sign_tree() {
  # -perm +111 is BSD-find syntax — correct on macOS; GNU find would want
  # /111. '*.dylib'/'*.so' catch Mach-O modules without an execute bit.
  find "$1" -type f \( -perm +111 -o -name '*.dylib' -o -name '*.so' \) -print0 |
  while IFS= read -r -d '' f; do
    if file "$f" | grep -q 'Mach-O'; then
      codesign --force --options runtime --timestamp --sign "$IDENTITY" "$f"
    fi
  done
}

if [ -d "$ROOT/src-tauri/pgsql" ]; then
  sign_tree "$ROOT/src-tauri/pgsql"
else
  echo "warning: $ROOT/src-tauri/pgsql not provisioned — skipping pgsql signing" >&2
fi

shopt -s nullglob
for sidecar in "$ROOT"/src-tauri/binaries/hotel-app-be-*; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$sidecar"
done
for be in "$BACKEND_ROOT"/target/release/hotel-app-be "$BACKEND_ROOT"/target/debug/hotel-app-be; do
  [ -e "$be" ] || continue
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$be"
done
echo "Signed bundled resources with $IDENTITY"
