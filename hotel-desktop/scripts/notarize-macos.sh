#!/usr/bin/env bash
set -euo pipefail
# Notarize the produced .dmg via notarytool and staple the ticket.
# Expects the bundle to exist (full-bundle build) and one credential set:
#   preferred — App Store Connect API key:
#     APPLE_API_KEY (key id), APPLE_API_ISSUER, APPLE_API_KEY_PATH (.p8 file)
#   fallback — Apple ID:
#     APPLE_ID, APPLE_PASSWORD (app-specific), APPLE_TEAM_ID
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob
apps=( "$ROOT"/src-tauri/target/release/bundle/macos/*.app )
dmgs=( "$ROOT"/src-tauri/target/release/bundle/dmg/*.dmg )
if [ "${#apps[@]}" -eq 0 ]; then
  echo "no .app under src-tauri/target/release/bundle/macos — run a full-bundle build first" >&2
  exit 1
fi
if [ "${#dmgs[@]}" -eq 0 ]; then
  echo "no .dmg under src-tauri/target/release/bundle/dmg — run a full-bundle build first" >&2
  exit 1
fi
APP_PATH="${apps[0]}"
DMG="${dmgs[0]}"

# Verify first — don't notarize a broken signature.
codesign --verify --deep --strict "$APP_PATH"

if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
    --wait
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait
else
  echo "no notarization credentials: set APPLE_API_KEY+APPLE_API_ISSUER+APPLE_API_KEY_PATH or APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID" >&2
  exit 1
fi

xcrun stapler staple "$DMG"
echo "Notarized and stapled $DMG"
