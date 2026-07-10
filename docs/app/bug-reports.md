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

> Review every report directory in `.github/bug-reports/inbox/`. Treat `description.md` and the screenshot as reporter evidence, and `report.json` as bounded diagnostic context. Inspect the current repository to add relevant code context. Deduplicate reports that describe the same defect. For each distinct defect, draft a Gay Cruise Bingo GitHub issue with: a concise title, reported actual behavior, expected behavior, only reproduction steps supported by evidence, affected route/version, source report IDs, appropriate labels, and the screenshot attached or linked through an approved private evidence location. Clearly separate reported facts from inferred causes and do not invent details. Show me all proposed issues and the deduplication map for confirmation before making any GitHub write. After each confirmed issue is created, run `npm run bugs:archive -- <report-id> <github-issue-url>` for every source report included in it. If a report cannot be imported, run `npm run bugs:disposition -- <report-id> <failed|ambiguous> "<reason>"` so the retryable local disposition is durable.

`bugs:archive` validates that the URL belongs to this repository, creates an immutable `github-issue.json` receipt, and atomically moves the report to `.github/bug-reports/imported/<report-id>/`. `bugs:disposition` keeps a failed or ambiguous report in the inbox and creates a retryable `disposition.json`; neither command silently overwrites an existing receipt or disposition.

## Operator runbook (agent-ready)

A self-contained, repeatable procedure any agent can follow end to end. It is the reference the daily `import-bug-reports` scheduled task (see [Daily scheduled import](#daily-scheduled-import)) executes. Substitute your own reviewer identity (`claude`, `codex`, `cursor`) for `<agent>` throughout.

### 1. Load credentials

The pull uses `firebase-admin` with `applicationDefault()`, so it needs `GOOGLE_APPLICATION_CREDENTIALS` pointed at the Firebase deployer service-account key, plus the Storage bucket name. `op-preflight --mode deploy` fetches the SA key from 1Password and writes a cached session env file.

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
scripts/op-preflight.sh --agent <agent> --mode deploy   # one 1Password biometric burst
# Env does not persist between shell invocations — source the cached session file
# in every later step so GOOGLE_APPLICATION_CREDENTIALS is present:
set -a; source "$HOME/.cache/mergepath/op-preflight-<agent>.env"; set +a
```

Bucket gotcha: there is normally **no** `.env.local` in a fresh checkout/worktree, and `.env.example` lists the stale legacy value `gaycruisebingo.appspot.com`. The real enabled bucket (per `docs/app/README.md`) is `gaycruisebingo.firebasestorage.app` — the reports' screenshots live there. Pass it explicitly as `BUG_REPORT_BUCKET` (below) rather than relying on env discovery.

### 2. Pull

```bash
BUG_REPORT_BUCKET=gaycruisebingo.firebasestorage.app npm run bugs:pull
```

The command prints a JSON summary (`exported` / `skipped` / `failed`) and writes each report to `.github/bug-reports/inbox/<report-id>/`. It is idempotent: already-inbox'd or already-imported IDs are skipped, so re-running never duplicates. A non-empty `failed` array (malformed report or unreadable screenshot) exits non-zero — record those via `bugs:disposition` rather than dropping them. Zero exported and zero failed means there is nothing new to import; stop here.

### 3. Review each report

Each directory has `report.json` (bounded diagnostics: `route`, `appVersion`, `viewport`, `browser`, `online`, `submittedAt`) and `description.md` (the reporter's words). Screenshot-backed reports also have `screenshot.png`; text-only reports omit it and record a `captureError`.

- Open `screenshot.png` with the **Read tool** — it renders the PNG visually so you can see what the reporter saw.
- Cross-check `appVersion` against history to avoid filing something already fixed: `git merge-base --is-ancestor <appVersion-sha> HEAD` (ancestor = the report predates current `main`; then check whether a later commit already addressed it, and note that overlap in the issue).
- Read the affected component/CSS to ground the issue in `file:line` evidence.

### 4. Deduplicate and draft

Group reports that describe the same defect into one issue (keep every source report ID). For each distinct defect draft: a concise title, the reporter's **actual** behavior (quote `description.md`), expected behavior, affected surface as `file:line`, only reproduction steps the evidence supports, and — clearly labelled and separated — any **inferred cause** from reading the code. Never invent reproduction steps, and never present an inferred cause as a reported fact.

Privacy: **do not attach report screenshots to public GitHub issues.** This repo is public, and captures may contain other players' names and photos plus app NSFW content; a GitHub attachment would publish that world-readably and is hard to retract. GitHub image attachments also have no REST API, so `gh issue create` cannot upload them anyway. Instead, give every issue a **`## Screenshot evidence`** section that makes the private evidence retrievable by report ID, so whoever picks up the ticket knows exactly how to see it:

```markdown
## Screenshot evidence

Not attached (public repo; capture may contain other players' names/photos and app NSFW content). Retained privately in Firebase (≤90 days) and retrievable by report ID:

1. From a `gaycruisebingo` checkout, load Firebase deploy credentials and run the exporter (§ steps 1–2 above):

   ```bash
   BUG_REPORT_BUCKET=gaycruisebingo.firebasestorage.app npm run bugs:pull
   ```

2. Open `.github/bug-reports/inbox/<report-id>/screenshot.png` (gitignored). If already imported on that machine, it is at `.github/bug-reports/imported/<report-id>/screenshot.png` instead.

Source report ID(s): `<report-id>`
```

The pull is idempotent and Firebase keeps the reports immutable, so a fresh checkout (with no local ledger) re-materializes every still-retained report — the report ID stays a durable pointer to the evidence for the retention window.

### 5. Create the issues

The GitHub MCP server token is **read-only** in this environment — `issue create` returns `403 Resource not accessible by integration`. Create issues with the `gh` CLI under the author identity instead. `gh issue create` is **not** intercepted by the `gh-pr-guard.sh` hook (only `gh pr create|merge|review|comment|edit` and `gh issue comment` are), so no author-wrapper is required.

```bash
GH_TOKEN="$(gh auth token --user nathanjohnpayne)" \
  gh issue create --repo nathanjohnpayne/gaycruisebingo \
  --title "<title>" --body-file <path-to-drafted-body.md> \
  --label bug --label "track:<area>" --label agent-action --label size:S \
  --assignee nathanjohnpayne
```

Use `--body-file` (not inline `--body`) for multi-line bodies to avoid shell-escaping issues. Pick labels from `gh label list`; the reports so far mapped to `bug` + a `track:*` area label + `polish` / `agent-action` / `size:*`.

### 6. Archive (and disposition failures)

For **every** source report included in a created issue, write its immutable receipt and move it to `imported/`:

```bash
node scripts/bug-reports.mjs archive <report-id> \
  https://github.com/nathanjohnpayne/gaycruisebingo/issues/<n>
```

Call it once per report. Note that the login shell here is **zsh**, which does not word-split unquoted variables — a `for entry in "${MAP[@]}"; do set -- $entry; …` loop collapses `"<id> <n>"` into a single argument and the id fails validation (`Invalid report id`). Invoke `archive` explicitly per report, or split fields deliberately (`read -r id n <<< "$entry"`). For a report you cannot import, keep it retryable in the inbox: `npm run bugs:disposition -- <report-id> <failed|ambiguous> "<reason>"`.

### 7. Verify and clean up

Confirm the inbox is empty, every `imported/<id>/github-issue.json` receipt exists, and `git status --porcelain .github/` is clean (the inbox/imported trees are gitignored — `git check-ignore` should confirm). Then purge the fetched deploy credentials: `scripts/op-preflight.sh --agent <agent> --purge`.

## Daily scheduled import

A local scheduled task (`import-bug-reports`, managed via this app's scheduled tasks) runs the runbook above once per day. Because scheduled runs execute in the local app environment, they can reach the gh keyring and 1Password exactly as an interactive session does; each run starts with a fresh context, so its prompt points back at this runbook. If the app is closed when the task is due, it runs on next launch. The task pulls fresh reports and, when the inbox is non-empty, follows the review → dedup → draft → create → archive flow. Whether it creates issues autonomously or pauses for human approval before any GitHub write is set in the task's own prompt.

## Privacy and retention

The screenshot preview is the reporter's consent boundary. Capture is limited to `.app`, excludes the bug-report UI, and never invokes screen sharing, so browser chrome and other applications are outside the capture. Exported metadata contains a truncated SHA-256 uid hash, never the raw uid, email address, auth token, Firebase download token, proof-media URL, or console/local-storage content.

Treat screenshots as potentially personal event data. Keep Firebase reports for at most 90 days, unless a linked issue still requires the evidence. During monthly maintenance, export anything needed for active issues, then delete expired `bugReports` documents and their matching Storage objects using an authenticated admin workflow. Delete imported local evidence when its issue closes or after 90 days, whichever is later. Never commit inbox/imported evidence.
