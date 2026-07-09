/**
 * Reusable transactional-email wrapper over the Resend Node SDK (issue #101).
 * Best-effort and NEVER throws: a Resend `{ error }` or a thrown transport error
 * is logged and surfaced as `false`, so a mail failure can never fail the write
 * that triggered it (ADR 0001). The Resend client and `firebase-functions/params`
 * config are lazy-loaded and both `from` and the transport are injectable, so
 * this module has no heavy top-level imports and is unit-testable without a
 * Functions runtime or a live key.
 */

/** Payload passed to Resend's `emails.send`. */
export interface EmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

/** The transport seam — the real one calls `new Resend(...).emails.send`. */
export type EmailSender = (
  payload: EmailPayload,
  opts: { idempotencyKey: string },
) => Promise<{ error: unknown }>;

export interface SendEmailArgs {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  idempotencyKey: string;
  /** Override the `EMAIL_FROM` param default (mainly for tests). */
  from?: string;
  /** Override the Resend transport (mainly for tests). */
  sender?: EmailSender;
}

/**
 * Send one email to one or more recipients. Returns `true` on a clean send,
 * `false` on any Resend error or thrown transport error. Never throws.
 */
export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  // The ENTIRE real-path setup — param/secret resolution and Resend
  // construction — sits inside the try, so a setup failure (e.g. an unresolved
  // RESEND_API_KEY) returns false instead of rejecting. That keeps the
  // never-throw contract for every caller, not just the moderation trigger with
  // its own outer catch (#101 Codex R3 F3).
  try {
    let from = args.from;
    let send = args.sender;
    if (!send || from === undefined) {
      // Only the real (non-injected) path — inside the Functions runtime.
      const { RESEND_API_KEY, EMAIL_FROM } = await import('./params');
      if (from === undefined) from = EMAIL_FROM.value();
      if (!send) {
        const apiKey = RESEND_API_KEY.value(); // throws here if the secret is unresolved
        const { Resend } = await import('resend');
        const client = new Resend(apiKey);
        send = (payload, opts) => client.emails.send(payload, opts) as Promise<{ error: unknown }>;
      }
    }
    const payload: EmailPayload = { from, to: args.to, subject: args.subject, html: args.html, text: args.text };
    const { error } = await send(payload, { idempotencyKey: args.idempotencyKey });
    if (error) {
      console.error('resend send failed', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('resend send failed (setup or transport)', err);
    return false;
  }
}
