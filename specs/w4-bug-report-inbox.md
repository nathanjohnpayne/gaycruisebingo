# W4 — Private bug-report inbox

## Behavior

A signed-in Player can open a persistent, unobtrusive lower-right bug-report control above the fixed tab bar from every authenticated route. The control uses the [Lucide Bug](https://lucide.dev/icons/bug) outline (ISC license) as an inline, theme-token-colored SVG, remains a 44×44 px target on phones, expands to a labeled pill on wider screens, shifts above the install prompt, and disappears while a sheet or celebration is open. It is app-shell utility chrome, not a primary tab.

Opening the control captures only the rendered `.app` surface while excluding the reporting UI. The sheet explains which diagnostics are sent and previews the screenshot. A capture failure never discards the description: the Player can retry capture or submit text only. Submission includes bounded description, current app-relative route, event id, deployed commit, user agent, viewport, online state, optional capture error, and optional PNG. It includes no email, token, console log, local-storage value, proof URL, browser chrome, or other application.

The authenticated `submitBugReport` callable is the only write path. It validates the schema and real PNG signature, rate-limits a uid to three reports per rolling 15-minute window, hashes the uid before storing report metadata, and writes screenshot evidence privately with no browser read path. When `BUG_REPORT_APP_CHECK` is enabled after #44, a missing App Check token fails closed.

An operator manually runs `npm run bugs:pull` to atomically materialize new immutable reports under the gitignored `.github/bug-reports/inbox/`. The exporter is idempotent across inbox and imported reports and removes partial output after a malformed report or failed download. The LLM workflow requires confirmation before GitHub writes, distinguishes evidence from inference, deduplicates related reports, and archives each imported source with an issue receipt through `npm run bugs:archive`.

## Testing

- `src/components/w4-bug-report-inbox.test.tsx` covers accessible placement, capture preview/fallback, submission metadata, retry, and success/error states.
- `tests/functions/bug-reports.test.ts` covers server validation, PNG verification, and rate-limit boundaries.
- `src/data/w4-bug-report-export.test.ts` covers atomic export, idempotency, malformed screenshots, and archive receipts.
- `tests/rules/w4-bug-report-inbox.test.ts` proves direct Firestore and Storage access is denied.
