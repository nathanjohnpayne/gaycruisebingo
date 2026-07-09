/**
 * Functions v2 config for transactional email (issue #101). Only ever
 * lazy-imported by email.ts/notify.ts (never statically, so their unit tests
 * stay free of firebase-functions), plus statically by index.ts to bind the
 * secret. RESEND_API_KEY is a Secret Manager secret (set out of band with
 * `firebase functions:secrets:set RESEND_API_KEY`), NEVER a plain env var.
 */
import { defineSecret, defineString } from 'firebase-functions/params';

export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
export const EMAIL_FROM = defineString('EMAIL_FROM', {
  default: 'Gay Cruise Bingo <gaycruisebingo@nathanpayne.com>',
});
/** Optional shared-inbox override, comma-separated. Empty = roster only. */
export const ADMIN_NOTIFY_EMAIL = defineString('ADMIN_NOTIFY_EMAIL', { default: '' });
/** Base URL for the Admin-console deep link in notification bodies. */
export const APP_BASE_URL = defineString('APP_BASE_URL', { default: 'https://gaycruisebingo.com' });
