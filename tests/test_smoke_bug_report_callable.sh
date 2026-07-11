#!/usr/bin/env bash
# tests/test_smoke_bug_report_callable.sh
#
# Unit tests for scripts/smoke-bug-report-callable.sh (issue #158). The script
# asserts that an unauthenticated request to the submitBugReport callable comes
# back as the application-code UNAUTHENTICATED error (HTTP 401), and fails
# loudly on the regression where the request is blocked at the Cloud Run
# invoker IAM layer instead (HTTP 403).
#
# Strategy: PATH-shim `curl` via the CURL_BIN override so no network is touched.
# The stub echoes a canned body + HTTP status (in the same `body\n%{http_code}`
# shape the script asks curl for with `-w $'\n%{http_code}'`), driven by a
# SCENARIO env var. We assert the script's exit status per scenario.
#
# Bash 3.2 portable.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/smoke-bug-report-callable.sh"

[[ -x "$SCRIPT" ]] || { echo "missing or non-executable $SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/test-smoke-bug.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

# Stub curl: emit "<body>\n<http_code>" for the SCENARIO, ignoring all args.
STUB="$WORKDIR/curl"
cat >"$STUB" <<'STUB'
#!/usr/bin/env bash
case "${SCENARIO:-}" in
  unauth)   printf '%s\n%s' '{"error":{"message":"Sign in before reporting a bug.","status":"UNAUTHENTICATED"}}' '401' ;;
  blocked)  printf '%s\n%s' '<html>403 Forbidden</html>' '403' ;;
  ok200)    printf '%s\n%s' '{"result":{"reportId":"x"}}' '200' ;;
  wrongbody) printf '%s\n%s' '{"error":{"status":"INTERNAL"}}' '401' ;;
  *) echo "bad scenario" >&2; exit 99 ;;
esac
STUB
chmod +x "$STUB"

run_smoke() { # <scenario>
  SCENARIO="$1" CURL_BIN="$STUB" bash "$SCRIPT" --url http://stub.invalid >"$WORKDIR/out" 2>&1
}

# 1. 401 + UNAUTHENTICATED body → PASS (exit 0)
if run_smoke unauth; then
  if grep -q 'reached application code' "$WORKDIR/out"; then
    pass "401 UNAUTHENTICATED passes"
  else
    fail "401 UNAUTHENTICATED: unexpected output: $(cat "$WORKDIR/out")"
  fi
else
  fail "401 UNAUTHENTICATED should exit 0, exited $?"
fi

# 2. 403 → FAIL, and the diagnostic must name the Cloud Run invoker regression
if run_smoke blocked; then
  fail "403 blocked should exit non-zero"
elif grep -qi 'invoker IAM' "$WORKDIR/out"; then
  pass "403 fails with invoker-IAM diagnostic"
else
  fail "403: missing invoker-IAM diagnostic: $(cat "$WORKDIR/out")"
fi

# 3. 200 (any non-401) → FAIL
if run_smoke ok200; then
  fail "HTTP 200 should exit non-zero"
else
  pass "unexpected HTTP 200 fails"
fi

# 4. 401 but body is not UNAUTHENTICATED → FAIL
if run_smoke wrongbody; then
  fail "401 without UNAUTHENTICATED body should exit non-zero"
else
  pass "401 with wrong body fails"
fi

echo
echo "smoke-bug-report tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
