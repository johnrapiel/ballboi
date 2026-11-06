// Turns Clerk errors into short, plain messages for sign-in screens.

/** Returns Clerk's error code, e.g. "form_identifier_not_found", if there is one. */
export function clerkErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; errors?: { code?: unknown }[] };
  const nested = e.errors?.[0]?.code;
  if (typeof nested === "string") return nested;
  return typeof e.code === "string" ? e.code : undefined;
}

const MESSAGES: Record<string, string> = {
  form_identifier_not_found: "We couldn't find an account with that email.",
  form_param_format_invalid: "That doesn't look like an email address.",
  form_code_incorrect: "That code isn't right. Check the email and try again.",
  verification_expired: "That code expired. Send a new one.",
  verification_failed: "That code didn't work. Send a new one.",
  too_many_requests: "Too many tries. Wait a minute, then try again.",
  network_error: "No connection. Check your signal and try again.",
};

export function friendlyAuthError(err: unknown): string {
  const code = clerkErrorCode(err);
  return (code && MESSAGES[code]) ?? "Something went wrong. Try again.";
}

// ─── Unfinished sign-in or sign-up (finding #22) ─────────────────────────────

export const SIGN_UP_UNFINISHED =
  "We couldn't finish creating your account. Try again later, or continue with Apple or Google.";
export const SIGN_IN_UNFINISHED = "We couldn't finish signing you in. Try again.";

/**
 * The message when the code was right but Clerk still isn't done. For a new
 * account with status "missing_requirements" (Clerk wants something the app
 * never asks for, such as a password), says sign-up couldn't finish instead
 * of a vague "Something went wrong".
 */
export function unfinishedAuthMessage(mode: "signIn" | "signUp"): string {
  return mode === "signUp" ? SIGN_UP_UNFINISHED : SIGN_IN_UNFINISHED;
}

/**
 * The log line for the Metro terminal: the status plus which fields Clerk is
 * missing or hasn't verified, e.g.
 * "missing_requirements (missing: password; unverified: none)".
 */
export function unfinishedAuthDetail(resource: {
  status?: string | null;
  missingFields?: readonly string[] | null;
  unverifiedFields?: readonly string[] | null;
}): string {
  const status = resource.status ?? "unknown";
  if (resource.missingFields == null && resource.unverifiedFields == null) return status;
  const list = (f: readonly string[] | null | undefined) => (f && f.length ? f.join(", ") : "none");
  return `${status} (missing: ${list(resource.missingFields)}; unverified: ${list(resource.unverifiedFields)})`;
}
