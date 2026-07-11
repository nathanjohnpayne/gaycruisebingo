#!/usr/bin/env bash
set -euo pipefail

# Reproducible invoker configuration for the submitBugReport callable (#158).
#
# The org policy on this project rejects an `allUsers` Cloud Run invoker IAM
# binding (Domain Restricted Sharing), which is the binding `firebase deploy`
# normally adds to make a callable publicly reachable. The org-policy-compatible
# alternative is to DISABLE the Cloud Run invoker IAM check on the function's
# backing service: the service then accepts unauthenticated requests at the
# network layer, and the callable enforces Firebase Auth in application code
# (returns UNAUTHENTICATED). See docs/app/bug-reports.md § Repeat-deploy
# hardening and issue #158.
#
# A `firebase deploy --only functions` can reset this — it may re-try the
# rejected allUsers binding and report a partial failure, leaving the callable
# unreachable. Re-run this AFTER any Functions deploy to restore the reachable
# state. It is idempotent: if the invoker IAM check is already disabled it
# no-ops.
#
# Usage:
#   scripts/set-bug-report-invoker.sh              # apply to prod (default)
#   scripts/set-bug-report-invoker.sh --dry-run    # print the action, change nothing
#
# Environment / overrides (defaults target this project's prod callable):
#   BUG_REPORT_PROJECT   GCP project      (default: gaycruisebingo)
#   BUG_REPORT_REGION    Cloud Run region (default: us-central1)
#   BUG_REPORT_SERVICE   Cloud Run service name (default: submitbugreport —
#                        the lowercased Gen2 function name)
#   GCLOUD_BIN           gcloud binary (default: gcloud; the 1Password-backed
#                        wrapper on PATH resolves credentials)
#
# Verify the result with: scripts/smoke-bug-report-callable.sh

PROJECT="${BUG_REPORT_PROJECT:-gaycruisebingo}"
REGION="${BUG_REPORT_REGION:-us-central1}"
SERVICE="${BUG_REPORT_SERVICE:-submitbugreport}"
GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"
DRY_RUN=false
INVOKER_ANNOTATION='run.googleapis.com/invoker-iam-disabled'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '3,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

run_gcloud() { "$GCLOUD_BIN" "$@"; }

echo ">> Bug-report invoker config: service=$SERVICE region=$REGION project=$PROJECT"

# Confirm the service exists before mutating anything — a wrong/renamed service
# should fail with a helpful list, not a confusing update error.
if ! current="$(run_gcloud run services describe "$SERVICE" \
      --region "$REGION" --project "$PROJECT" \
      --format="value(metadata.annotations[\"$INVOKER_ANNOTATION\"])" 2>/dev/null)"; then
  echo "FAIL: could not describe Cloud Run service '$SERVICE' in $REGION ($PROJECT)." >&2
  echo "      Available services:" >&2
  run_gcloud run services list --project "$PROJECT" --region "$REGION" \
    --format='value(metadata.name)' >&2 || true
  echo "      Set BUG_REPORT_SERVICE to the correct name and re-run." >&2
  exit 1
fi

if [[ "$current" == "true" ]]; then
  echo "   Invoker IAM check already disabled — nothing to do (idempotent)."
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "   [dry-run] would run: gcloud run services update $SERVICE \\"
  echo "             --region $REGION --project $PROJECT --no-invoker-iam-check"
  exit 0
fi

echo "   Disabling the Cloud Run invoker IAM check (org-policy-compatible reachability)…"
run_gcloud run services update "$SERVICE" \
  --region "$REGION" --project "$PROJECT" --no-invoker-iam-check

echo "   Done. Verify with: scripts/smoke-bug-report-callable.sh"
