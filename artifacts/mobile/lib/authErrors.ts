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
