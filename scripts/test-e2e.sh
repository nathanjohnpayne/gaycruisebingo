#!/usr/bin/env bash
set -euo pipefail

# Emulator-backed Playwright runner with argument forwarding (Codex P3 on
# PR #114 round 2). `firebase emulators:exec` takes ONE script string, so the
# previous inline form — `firebase emulators:exec ... "playwright test"` —
# dropped anything after `npm run test:e2e --` onto emulators:exec itself,
# where it either errored or was ignored; targeted runs like
# `npm run test:e2e -- tests/e2e/foo.spec.ts --grep "title"` never reached
# Playwright. This wrapper shell-quotes every forwarded argument (printf %q,
# space-safe) into that one script string, so CLI args reach Playwright
# intact.
#
# `npm run test:e2e` is the emulator-backed, self-contained entry point; a
# bare `npx playwright test` requires emulators already running (see
# specs/x-e2e-happy-path.md).

cmd="npx playwright test"
for arg in "$@"; do
  cmd+=" $(printf '%q' "$arg")"
done

exec npx firebase emulators:exec --only auth,firestore,storage "$cmd"
