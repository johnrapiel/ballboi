// Email code sign-in: when to steer someone to another way in, and the
// resend cooldown. Spec: Roles and onboarding, step 1; Wave 1 review A1 and A2.
// Nothing here locks anyone out: the code field always stays usable.

/** Wrong codes before the screen suggests Apple, Google, or another email. */
export const MAX_WRONG_CODES = 3;
/** Resends (sends after the first) before the same suggestion. */
export const MAX_RESENDS = 2;
/** Seconds Resend code stays disabled after each send. */
export const RESEND_COOLDOWN_SECONDS = 30;

export const STEER_MESSAGE = "Still not working? Try Apple or Google instead, or use another email.";

/** Clerk error codes that mean the code itself was wrong. */
const WRONG_CODE_ERRORS = new Set(["form_code_incorrect", "verification_failed"]);

export function isWrongCodeError(code: string | undefined): boolean {
  return !!code && WRONG_CODE_ERRORS.has(code);
}

/** Tries for one email address. Starts over when the address changes. */
export interface Attempts {
  email: string;
  /** Codes sent to this address, including the first. */
  sends: number;
  wrongCodes: number;
}

export const NO_ATTEMPTS: Attempts = { email: "", sends: 0, wrongCodes: 0 };

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function afterSend(prev: Attempts, email: string): Attempts {
  if (!sameEmail(prev.email, email)) return { email: email.trim(), sends: 1, wrongCodes: 0 };
  return { ...prev, sends: prev.sends + 1 };
}

export function afterWrongCode(prev: Attempts): Attempts {
  return { ...prev, wrongCodes: prev.wrongCodes + 1 };
}

/** True once there have been three wrong codes or two resends. */
export function shouldSteer(a: Attempts): boolean {
  return a.wrongCodes >= MAX_WRONG_CODES || a.sends - 1 >= MAX_RESENDS;
}

/** Whole seconds until Resend code works again; 0 when it's available. */
export function resendSecondsLeft(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  const left = RESEND_COOLDOWN_SECONDS - Math.floor((now - lastSentAt) / 1000);
  return Math.max(0, Math.min(RESEND_COOLDOWN_SECONDS, left));
}
