#!/usr/bin/env bash
# End-to-end demo of the ESP32 upload contract against a running server.
#   server/scripts/test-upload.sh [base-url]        (default http://127.0.0.1:3100)
# DEVICE_KEY is taken from the environment, or from the repository's .env file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:3100}}"
PHOTO="$SCRIPT_DIR/../test/fixtures/sample.jpg"

if [[ -z "${DEVICE_KEY:-}" && -f "$REPO_ROOT/.env" ]]; then
  DEVICE_KEY="$(grep -E '^DEVICE_KEY=' "$REPO_ROOT/.env" | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/')"
fi
: "${DEVICE_KEY:?Set DEVICE_KEY or create .env}"

UPLOAD_ID="demo-$(date +%s)-$RANDOM"
failures=0
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

# request <expected-status> <description> <curl args...>
request() {
  local expected="$1" description="$2"
  shift 2
  local status
  status="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' "$@")"
  local body
  body="$(cat "$BODY_FILE")"
  if [[ "$status" == "$expected" ]]; then
    printf 'PASS  %-46s %s %s\n' "$description" "$status" "$body"
  else
    printf 'FAIL  %-46s got %s, expected %s: %s\n' "$description" "$status" "$expected" "$body"
    failures=$((failures + 1))
  fi
  LAST_BODY="$body"
}

echo "Server: $BASE_URL"
request 200 "0. health check" "$BASE_URL/api/health"

request 201 "1. successful sample with photo" \
  -X POST "$BASE_URL/api/samples?ok=1&t=30.0&h=66.0&l=235" \
  -H "X-Device-Key: $DEVICE_KEY" \
  -H "X-Upload-Id: $UPLOAD_ID" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@$PHOTO"
FIRST_BODY="$LAST_BODY"

request 201 "2. failed sample (ok=0), no body" \
  -X POST "$BASE_URL/api/samples?ok=0" \
  -H "X-Device-Key: $DEVICE_KEY"

request 200 "3. retry with the same X-Upload-Id" \
  -X POST "$BASE_URL/api/samples?ok=1&t=30.0&h=66.0&l=235" \
  -H "X-Device-Key: $DEVICE_KEY" \
  -H "X-Upload-Id: $UPLOAD_ID" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@$PHOTO"
if [[ "$LAST_BODY" != "$FIRST_BODY" ]]; then
  echo "FAIL  retry returned a different sample: $LAST_BODY vs $FIRST_BODY"
  failures=$((failures + 1))
else
  echo "      retry returned the same sample: $LAST_BODY"
fi

request 401 "4. wrong device key" \
  -X POST "$BASE_URL/api/samples?ok=1&t=30.0&h=66.0&l=235" \
  -H "X-Device-Key: wrong-key" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@$PHOTO"

SAMPLE_ID="$(sed -E 's/.*"id":([0-9]+).*/\1/' <<<"$FIRST_BODY")"
request 200 "5. read the sample back" "$BASE_URL/api/samples/$SAMPLE_ID"
PHOTO_URL="$(sed -nE 's/.*"photoUrl":"([^"]+)".*/\1/p' <<<"$LAST_BODY")"
if [[ -n "$PHOTO_URL" ]]; then
  photo_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL$PHOTO_URL")"
  if [[ "$photo_status" == 200 ]]; then
    echo "PASS  6. photo is served at $PHOTO_URL"
  else
    echo "INFO  6. photo URL $PHOTO_URL returned $photo_status (expected 404 when SERVE_PHOTOS is off)"
  fi
fi

if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
