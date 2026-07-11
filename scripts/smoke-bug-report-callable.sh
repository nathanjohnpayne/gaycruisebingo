#!/usr/bin/env bash
set -euo pipefail

# Production smoke check for the submitBugReport callable (issue #158).
#
# Sends ONE unauthenticated request to the live callable and asserts it
# returns the application-code UNAUTHENTICATED error — proving two things at
# once:
#
#   1. The request reaches application code at all. The org policy rejects an
#      `allUsers` Cloud Run invoker binding, so production is made reachable by
#      DISABLING the Cloud Run invoker IAM check (see
#      scripts/set-bug-report-invoker.sh). If a later `firebase deploy` silently
#      re-enabled that check (or re-tried the rejected allUsers binding), an
#      unauthenticated request would be blocked at the Cloud Run layer and come
#      back as an HTTP 403 with Google's own error body — NOT the app's JSON.
#      This check fails loudly in that case.
#   2. The callable still enforces Firebase Auth in application code:
#      `handleSubmitBugReport` throws `HttpsError('unauthenticated', …)` when
#      there is no `request.auth`, which the callable protocol serializes as an
#      HTTP 401 body `{"error":{"status":"UNAUTHENTICATED", …}}`.
#
# It is a LOAD-AND-ASSERT probe only: an unauthenticated request can never pass
# the auth gate, so it never creates a bugReports doc, writes Storage, or has
# any side effect. Safe to run against production on every deploy or on a
# schedule.
#
# Usage:
#   scripts/smoke-bug-report-callable.sh                    # live prod callable
#   scripts/smoke-bug-report-callable.sh --url <callable-url>
#
# Environment:
#   BUG_REPORT_CALLABLE_URL  Override the callable URL (same as --url).
#   CURL_BIN                 curl binary to use (default: curl). Tests shim it.
#
# Exit status: 0 on pass; 1 on any assertion failure (with a diagnostic that
# distinguishes the "blocked at Cloud Run" regression from other failures).

DEFAULT_URL="https://us-central1-gaycruisebingo.cloudfunctions.net/submitBugReport"
URL="${BUG_REPORT_CALLABLE_URL:-$DEFAULT_URL}"
CURL_BIN="${CURL_BIN:-curl}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:?--url needs a value}"; shift 2 ;;
    -h|--help) sed -n '3,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

echo ">> Bug-report callable smoke check: $URL"

# The callable protocol is a POST with a JSON `{"data": …}` envelope. An empty
# data object is enough — the auth gate rejects before any input validation.
# Capture the body and the HTTP status on the last line so a malformed body
# can never be mistaken for a status code.
response="$(
  "$CURL_BIN" -sS \
    --connect-timeout 10 --max-time 30 \
    -o - -w $'\n%{http_code}' \
    -X POST "$URL" \
    -H 'Content-Type: application/json' \
    --data '{"data":{}}'
)" || { echo "FAIL: request to callable failed (network / DNS / timeout)" >&2; exit 1; }

http_code="${response##*$'\n'}"
body="${response%$'\n'*}"

echo "   HTTP $http_code"
echo "   body: $body"

if [[ "$http_code" == "403" ]]; then
  cat >&2 <<EOF
FAIL: callable returned HTTP 403 — the request was blocked at the Cloud Run
invoker IAM layer before reaching application code. The org-policy-compatible
invoker configuration has regressed (a redeploy likely re-enabled the invoker
IAM check). Restore it with:

  scripts/set-bug-report-invoker.sh

See docs/app/bug-reports.md § Repeat-deploy hardening.
EOF
  exit 1
fi

if [[ "$http_code" != "401" ]]; then
  echo "FAIL: expected HTTP 401 (UNAUTHENTICATED), got HTTP $http_code" >&2
  exit 1
fi

# Body assertion: the callable serializes HttpsError('unauthenticated') as a
# JSON error with `"status":"UNAUTHENTICATED"`. Match tolerantly of whitespace.
if [[ "$body" != *'"status"'*'"UNAUTHENTICATED"'* ]]; then
  echo "FAIL: HTTP 401 but body is not the expected UNAUTHENTICATED callable error" >&2
  exit 1
fi

echo "PASS: unauthenticated request reached application code and returned UNAUTHENTICATED."
