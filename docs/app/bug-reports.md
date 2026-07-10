# Bug-report inbox

Signed-in players can submit a description and previewed screenshot from the persistent **Report a bug** control. The browser sends the report to the `submitBugReport` callable Function; it never receives GitHub credentials and cannot read the private intake queue. The Function validates PNG bytes and bounded diagnostics, hashes the Firebase uid, limits each uid to three reports per 15-minute window, and writes immutable metadata to `bugReports/{reportId}` plus optional evidence to `bug-reports/{reporterHash}/{reportId}/screenshot.png`.

Set `BUG_REPORT_APP_CHECK=true` only when App Check client registration and enforcement from #44 are live. With the parameter enabled, submissions without a valid App Check token fail closed.

## Pull reports locally

Run credential preflight in deploy mode, then export new reports:

```bash
eval "$(scripts/op-preflight.sh --agent codex --mode deploy)"
npm run bugs:pull
```

The command reads the Firebase project from `.firebaserc` and the bucket from `BUG_REPORT_BUCKET` or `VITE_FIREBASE_STORAGE_BUCKET` in `.env.local`. It writes each validated report atomically under `.github/bug-reports/inbox/<report-id>/`. Existing inbox or imported IDs are skipped, malformed reports are listed as failures, and partial directories are removed. The inbox and imported directories are gitignored.

A screenshot-backed report contains `report.json`, `description.md`, and `screenshot.png`. A text-only report intentionally omits `screenshot.png` and records its bounded capture error in `report.json`.

## LLM batch-import prompt

Point the LLM at `.github/bug-reports/inbox/` with this instruction:

> Review every report directory in `.github/bug-reports/inbox/`. Treat `description.md` and the screenshot as reporter evidence, and `report.json` as bounded diagnostic context. Inspect the current repository to add relevant code context. Deduplicate reports that describe the same defect. For each distinct defect, draft a Gay Cruise Bingo GitHub issue with: a concise title, reported actual behavior, expected behavior, only reproduction steps supported by evidence, affected route/version, source report IDs, appropriate labels, and the screenshot attached or linked through an approved private evidence location. Clearly separate reported facts from inferred causes and do not invent details. Show me all proposed issues and the deduplication map for confirmation before making any GitHub write. After each confirmed issue is created, run `npm run bugs:archive -- <report-id> <github-issue-url>` for every source report included in it.

`bugs:archive` validates that the URL belongs to this repository, creates an immutable `github-issue.json` receipt, and atomically moves the report to `.github/bug-reports/imported/<report-id>/`. A failed or ambiguous report remains in the inbox for retry.

## Privacy and retention

The screenshot preview is the reporter's consent boundary. Capture is limited to `.app`, excludes the bug-report UI, and never invokes screen sharing, so browser chrome and other applications are outside the capture. Exported metadata contains a truncated SHA-256 uid hash, never the raw uid, email address, auth token, Firebase download token, proof-media URL, or console/local-storage content.

Treat screenshots as potentially personal event data. Keep Firebase reports for at most 90 days, unless a linked issue still requires the evidence. During monthly maintenance, export anything needed for active issues, then delete expired `bugReports` documents and their matching Storage objects using an authenticated admin workflow. Delete imported local evidence when its issue closes or after 90 days, whichever is later. Never commit inbox/imported evidence.
