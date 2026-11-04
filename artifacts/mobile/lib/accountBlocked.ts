// A ban or suspension that starts while the app is open (Wave 1 review A7).
// The server refuses every request from a sanctioned account with a 403 and a
// code. Any such answer rechecks the account, and the root gate then shows
// the account blocked screen.

export const ACCOUNT_BLOCKED_CODES = ["account_banned", "account_suspended"] as const;

/** True for the server's "this account is banned or suspended" answer. */
export function isAccountBlockedError(status: number | undefined, body: unknown): boolean {
  if (status !== 403 || !body || typeof body !== "object") return false;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && (ACCOUNT_BLOCKED_CODES as readonly string[]).includes(code);
}

let listener: (() => void) | null = null;

/** The root layout listens; returns a function that stops listening. */
export function onAccountBlocked(l: () => void): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}

export function reportAccountBlocked() {
  listener?.();
}

/** Checks a failed request, from either API client, and reports a block. */
export function checkForAccountBlock(error: unknown) {
  const e = error as { status?: number; data?: unknown } | null;
  if (e && isAccountBlockedError(e.status, e.data)) reportAccountBlocked();
}
