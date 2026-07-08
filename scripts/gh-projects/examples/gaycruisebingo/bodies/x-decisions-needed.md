**Track:** launch · **Phase:** 0 · **Wave:** 0 · **Size:** S · **ADR(s):** —
**Labels:** decision-needed, track:launch, phase-0, wave-0, size:S

## Context & scope
Human-triage issue collecting the genuine open operational/config decisions, each tagged with the specific ticket it blocks. This is NOT agent-action code — no spec/test/build applies. It blocks ONLY the tagged tickets below, never the whole backlog; unrelated Wave-0/1 work proceeds in parallel. An Admin resolves each decision and edits the blocked ticket accordingly.

## Open decisions

### Admin roster (2–4 uids incl. Nathan's seed uid)
- **Question:** Which 2–4 Google-account uids are Admins of the `med-2026` Event (including Nathan's own seed uid)? `scripts/seed.mjs` reads the roster from the `ADMIN_UID` env.
- **Recommended default:** Nathan's uid + 1–2 trusted co-hosts; start minimal (Admin is the only privileged role).
- **Blocks:** #__NUM_w1-event-seed__.

### Confirm reportHideThreshold = 4
- **Question:** Does the presentational auto-hide threshold (hide a Prompt/Proof at `reportCount ≥ N`) stay at 4? `scripts/seed.mjs:71` seeds `reportHideThreshold: 4`.
- **Recommended default:** keep 4 for launch (ADR 0004); tune post-sail.
- **Blocks:** #__NUM_w2-admin-console__.

### Blaze budget ($)
- **Question:** What monthly budget-alert threshold ($) before upgrading to Blaze (which gates Functions + Cloud Vision for Phase 1)?
- **Recommended default:** a low guardrail with an alert, set BEFORE Phase 1 (PRD mitigation).
- **Blocks:** #__NUM_w4-infra-blaze-budget__.

### reCAPTCHA Enterprise key + enforcement timing
- **Question:** Which reCAPTCHA Enterprise key to provision, and when to flip App Check enforcement (Firestore + Storage) on? `firebase.ts` scaffolds `initializeAppCheck` with `ReCaptchaEnterpriseProvider` gated on `VITE_RECAPTCHA_SITE_KEY` (no-op without the key).
- **Recommended default:** provision pre-launch, enable enforcement AFTER a soft-launch smoke so early Players are not locked out.
- **Blocks:** #__NUM_w4-app-check__.

### Domain cutover timing
- **Question:** When to point `gaycruisebingo.com` (Cloudflare → Firebase Hosting, DNS-only) so Firebase can issue the cert (up to ~24 h)?
- **Recommended default:** cut over ≥ 48 h before sail to absorb cert-issuance latency.
- **Blocks:** #__NUM_w4-infra-domain__.

### GA4 consent copy / region
- **Question:** What consent-notice copy + region handling for the 18+ audience (GA4)?
- **Recommended default:** a lightweight in-app consent notice; no region gating beyond standard GA4 (confirm with counsel if EU traffic is expected).
- **Blocks:** #__NUM_w2-ga4-events__.

### Keep recomputeStats as labeled repair? (default: remove)
- **Question:** Remove `recomputeStats` (`functions/src/index.ts:68`) entirely, or keep it relabeled as explicit consistency/repair only (NOT anti-cheat)? ADR 0001: self-writable players are intentional, so recompute-as-anti-cheat contradicts it.
- **Recommended default:** REMOVE (ADR 0001); if kept at all, relabel as repair-only.
- **Blocks:** #__NUM_recon-recompute-stats__.

## Dependencies
- Depends on: none.
- Blocks (soft) #__NUM_w1-event-seed__, #__NUM_w2-admin-console__, #__NUM_w4-app-check__, #__NUM_w4-infra-domain__, #__NUM_w4-infra-blaze-budget__, #__NUM_w2-ga4-events__, #__NUM_recon-recompute-stats__ — each decision blocks only its tagged ticket, not the whole backlog.

## Resolution
This is a human-triage issue, not agent-action code: no spec/test/build DoD applies. Resolution = an Admin answers each decision above and edits the blocked ticket(s) accordingly, then closes this issue.
