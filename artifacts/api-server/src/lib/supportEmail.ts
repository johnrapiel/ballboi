// Emails to support@ballboi.tennis: "Something not working?" reports (B3) and
// the test-set deletion list when a tester withdraws (B12).
//
// Sent through Resend's HTTP API (no package needed). Off until a key is set:
//   RESEND_API_KEY        from resend.com > API Keys (free tier: 3,000 emails
//                         a month, 100 a day). Put it in .env locally and in
//                         Cloudflare secrets in production; never commit it.
//   SUPPORT_EMAIL_TO      default support@ballboi.tennis
//   SUPPORT_EMAIL_FROM    default "Ball Boi <support@ballboi.tennis>"; the
//                         domain must be verified in Resend first.
// Without a key nothing is sent: the caller keeps its record (reports stay in
// support_reports with emailed_at empty) and logs it, so nothing is lost.

import { logger } from "./logger";

export const SUPPORT_ADDRESS = "support@ballboi.tennis";

export interface SupportEmail {
  subject: string;
  text: string;
  /** The person to reply to, when there is one. */
  replyTo?: string | null;
}

export type SendResult = { sent: true } | { sent: false; reason: "not_configured" | "failed"; error?: string };

export interface EmailDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 10_000;

/** Sends one email to support. Never throws. */
export async function sendSupportEmail(email: SupportEmail, deps: EmailDeps = {}): Promise<SendResult> {
  const env = deps.env ?? process.env;
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    logger.info({ subject: email.subject }, "Support email not sent: RESEND_API_KEY isn't set");
    return { sent: false, reason: "not_configured" };
  }
  const doFetch = deps.fetch ?? fetch;
  const body: Record<string, unknown> = {
    from: env.SUPPORT_EMAIL_FROM?.trim() || `Ball Boi <${SUPPORT_ADDRESS}>`,
    to: [env.SUPPORT_EMAIL_TO?.trim() || SUPPORT_ADDRESS],
    subject: email.subject.slice(0, 200),
    text: email.text,
  };
  if (email.replyTo) body.reply_to = email.replyTo;
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const error = `Resend answered ${res.status}`;
      logger.warn({ status: res.status, subject: email.subject }, "Support email failed");
      return { sent: false, reason: "failed", error };
    }
    return { sent: true };
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "Support email failed");
    return { sent: false, reason: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
