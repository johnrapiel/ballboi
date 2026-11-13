// The beta's audio pick window (shot tracker test plan, T2 and T6). Pure, so
// the rules are easy to test; videoRetention.ts applies them and the admin
// beta-footage list shows the days left.

/** How long beta audio is held for John to pick test-set matches. */
export const AUDIO_PICK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AudioDecision = { hold: true } | { hold: false; reason: "withdrawn" | "launch" | "window" | "notBeta" };

/**
 * Keep the raw upload's audio, or delete it? Pure, so the rules are easy to
 * test. `heldAt` is when the hold began (null for a fresh upload).
 */
export function audioDecision(input: {
  beta: boolean;
  withdrawn: boolean;
  testSet: boolean;
  heldAt: string | null;
  now: Date;
  days?: number;
}): AudioDecision {
  if (input.withdrawn) return { hold: false, reason: "withdrawn" };
  if (!input.beta) return { hold: false, reason: input.heldAt ? "launch" : "notBeta" };
  if (input.testSet) return { hold: true };
  const since = input.heldAt ? Date.parse(input.heldAt) : NaN;
  if (Number.isFinite(since) && input.now.getTime() - since >= (input.days ?? AUDIO_PICK_DAYS) * DAY_MS) {
    return { hold: false, reason: "window" };
  }
  return { hold: true };
}

/** Days left in the audio pick window, or null when audio isn't held. */
export function audioDaysLeft(heldAt: unknown, now: Date, days = AUDIO_PICK_DAYS): number | null {
  if (typeof heldAt !== "string") return null;
  const since = Date.parse(heldAt);
  if (!Number.isFinite(since)) return null;
  return Math.max(0, Math.ceil((since + days * DAY_MS - now.getTime()) / DAY_MS));
}
