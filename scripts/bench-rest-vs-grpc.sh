#!/usr/bin/env bash
#
# REST-vs-gRPC latency/size benchmark for the Phase 2 pilot endpoints.
#
# Measures the SAME logical call on both transports against the SAME server
# and database, so the only difference is the adapter layer:
#
#   REST       GET  /api/rooms                            (JSON)
#   gRPC-Web   POST /hotel.rooms.v1.RoomService/ListRooms (protobuf)
#
# gRPC-Web unary is an ordinary HTTP/1.1 POST with a 5-byte message frame, so
# one tool drives both sides. `hey` is used when present, `vegeta` otherwise.
# The browser path is gRPC-Web, making this the comparison that matters for
# the React client; native h2 gRPC would only differ further in the
# transport's favor.
#
# Requirements:
#   - hey or vegeta on PATH  (brew install hey / vegeta)
#   - a running backend      (cargo run --bin hotel-app-be, port 3030)
#   - TOKEN env var          (a session-bound staff JWT with rooms:read —
#                             POST /api/auth/login and copy .access_token)
#
# Usage:
#   TOKEN="eyJ..." scripts/bench-rest-vs-grpc.sh [BASE_URL] [TOTAL] [CONCURRENCY]
#   TOKEN="eyJ..." scripts/bench-rest-vs-grpc.sh http://localhost:3030 2000 10
#
# Output: per-transport p50/p99 latency, throughput, and response bytes.
# Interpretation: these endpoints are DB-bound, so latency deltas mostly
# reflect codec cost (serde_json vs prost); the big win is response size.
# Report numbers, not vibes — see docs/grpc-migration/.

set -euo pipefail

BASE_URL="${1:-http://localhost:3030}"
TOTAL="${2:-2000}"
CONCURRENCY="${3:-10}"

if [ -z "${TOKEN:-}" ]; then
    echo "error: TOKEN env var required (session-bound staff JWT)" >&2
    exit 2
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# ListRoomsRequest{page_size: 200} — proto field 1 varint = 0x08 0xC8 0x01.
# gRPC-Web request body = 1-byte flag + 4-byte BE length + message bytes.
printf '\x00\x00\x00\x00\x03\x08\xc8\x01' > "$workdir/list_rooms.bin"

if command -v hey >/dev/null; then
    run_rest() {
        hey -n "$TOTAL" -c "$CONCURRENCY" -m GET \
            -H "Authorization: Bearer $TOKEN" \
            "$BASE_URL/api/rooms"
    }
    run_grpc() {
        hey -n "$TOTAL" -c "$CONCURRENCY" -m POST \
            -H "Authorization: Bearer $TOKEN" \
            -H 'Content-Type: application/grpc-web' -H 'X-Grpc-Web: 1' \
            -D "$workdir/list_rooms.bin" \
            "$BASE_URL/hotel.rooms.v1.RoomService/ListRooms"
    }
elif command -v vegeta >/dev/null; then
    cat > "$workdir/rest.target" <<EOF
GET $BASE_URL/api/rooms
Authorization: Bearer $TOKEN
EOF
    cat > "$workdir/grpc.target" <<EOF
POST $BASE_URL/hotel.rooms.v1.RoomService/ListRooms
Authorization: Bearer $TOKEN
Content-Type: application/grpc-web
X-Grpc-Web: 1
@$workdir/list_rooms.bin
EOF
    run_rest() {
        vegeta attack -targets="$workdir/rest.target" \
            -rate="$CONCURRENCY" -duration="$((TOTAL / CONCURRENCY))s" \
            | vegeta report -type='text'
    }
    run_grpc() {
        vegeta attack -targets="$workdir/grpc.target" \
            -rate="$CONCURRENCY" -duration="$((TOTAL / CONCURRENCY))s" \
            | vegeta report -type='text'
    }
else
    echo "error: neither hey nor vegeta on PATH" >&2
    exit 2
fi

echo "=== REST  GET /api/rooms ==="
run_rest
echo
echo "=== gRPC-Web  RoomService/ListRooms ==="
run_grpc
echo

# Response-size comparison: one request each, bytes on the wire.
echo "=== response sizes (single call) ==="
rest_bytes=$(curl -s -o /dev/null -w '%{size_download}' \
    -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/rooms")
grpc_bytes=$(curl -s -o /dev/null -w '%{size_download}' \
    -X POST "$BASE_URL/hotel.rooms.v1.RoomService/ListRooms" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/grpc-web' -H 'X-Grpc-Web: 1' \
    --data-binary @"$workdir/list_rooms.bin")
printf 'REST JSON:      %8s bytes\ngRPC-Web proto: %8s bytes\n' "$rest_bytes" "$grpc_bytes"

cat <<'NOTE'

Notes for a fair read:
- Run against the same seeded DB volume for both transports.
- Auth is enforced on both (session JWT + rooms:read), so the numbers include
  the real per-call auth cost.
- gRPC-Web errors return HTTP 200 with grpc-status != 0 — sanity-check one
  response with `curl -D-` if a run looks off.
NOTE
