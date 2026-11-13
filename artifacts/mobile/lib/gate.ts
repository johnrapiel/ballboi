// One gate for every signed-in screen (Wave 1 review A3, A6). The root layout
// asks where the person must be, in this order: signed in, not blocked, age
// check passed, onboarding done. Deep links go through the same gate, so an
// invite link can't skip the age check or onboarding: the link is kept and
// opens once the person is in the app.
//
// Pure rules here, so they're easy to test. The root layout (app/_layout.tsx)
// does the navigating.

export type Gate =
  /** No session: Welcome, plus the screens a signed-out link can open. */
  | "signedOut"
  /** Signed in, waiting on the account check before the first step. */
  | "checking"
  /** Banned or suspended: only the account blocked screen and Delete account. */
  | "blocked"
  | "ageCheck"
  | "onboarding"
  | "app";

export interface GateInput {
  signedIn: boolean;
  /** The Clerk user has loaded. */
  hasUser: boolean;
  /** "pending" until /account/status answers. A failed check counts as "ok". */
  account: "ok" | "blocked" | "pending";
  aged: boolean;
  onboarded: boolean;
}

export function gateFor(s: GateInput): Gate {
  if (!s.signedIn) return "signedOut";
  if (!s.hasUser) return "checking";
  if (s.account === "blocked") return "blocked";
  // People already in the app aren't held at launch: if the check later says
  // blocked, they move to the blocked screen then.
  if (s.aged && s.onboarded) return "app";
  // Before the first step, the check finishes first, so a banned re-signup
  // sees the blocked screen and never the name step (A6).
  if (s.account === "pending") return "checking";
  if (!s.aged) return "ageCheck";
  return "onboarding";
}

/** A league invite or a Quick match invite, from a link. */
export type PendingLink = { kind: "league" | "match"; code: string };

/** "/join/ABC123" or "/record/invite/XYZ". Null for any other path. */
export function inviteFromPath(pathname: string): PendingLink | null {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "join" && parts[1]) return { kind: "league", code: parts[1] };
  if (parts.length === 3 && parts[0] === "record" && parts[1] === "invite" && parts[2]) {
    return { kind: "match", code: parts[2] };
  }
  return null;
}

const isInvite = (segments: string[]) =>
  segments[0] === "join" || (segments[0] === "record" && segments[1] === "invite");

/** Where each gate sends people who are somewhere they can't be. */
export const GATE_HOME = {
  signedOut: "/(auth)/welcome",
  blocked: "/account-blocked",
  ageCheck: "/age-check",
  onboarding: "/onboarding",
  app: "/(tabs)",
} as const;

export type GateRedirect = {
  to: (typeof GATE_HOME)[keyof typeof GATE_HOME];
  /** Keep this invite and open it after onboarding. */
  keep: PendingLink | null;
  /**
   * Clear every screen first, so Welcome is the only one left and there's
   * nothing to go back to (sign-out, Delete account; Wave 2 finding 59).
   */
  reset?: true;
};

/**
 * The sign-in stack's first screen (app/(auth)/_layout.tsx). Expo Router
 * orders a folder's screens by name length when none is set, which put
 * "email" first: a signed-out person could land on the email step with
 * nothing under it (Wave 2 finding 59).
 */
export const AUTH_FIRST_SCREEN = "welcome" as const;

/**
 * Back on the email sign-in screen: from the code step to the email step,
 * from the email step to Welcome. Never out of sign-in.
 */
export function emailBack(step: "email" | "code"): "emailStep" | "welcome" {
  return step === "code" ? "emailStep" : "welcome";
}

/**
 * Where to send the person from the current route, or null when they can stay.
 * `segments` are expo-router's route segments, like ["join", "[code]"].
 */
export function gateRedirect(gate: Gate, segments: string[], pathname: string): GateRedirect | null {
  const first = segments[0] ?? "";
  if (first === "+not-found") return null;
  switch (gate) {
    case "checking":
      return null;
    case "signedOut":
      // Signed-out invite screens save the code themselves and offer Sign in.
      // The age check signs an under-18 out on its way to the 18+ screen, so
      // it's allowed here and sends anyone else back to Welcome itself.
      if (first === "(auth)" || first === "eighteen-plus" || first === "age-check" || isInvite(segments)) return null;
      return { to: GATE_HOME.signedOut, keep: null, reset: true };
    case "blocked":
      if (first === "account-blocked" || first === "delete-account") return null;
      return { to: GATE_HOME.blocked, keep: null };
    case "ageCheck":
      if (first === "age-check" || first === "eighteen-plus") return null;
      return { to: GATE_HOME.ageCheck, keep: inviteFromPath(pathname) };
    case "onboarding":
      if (first === "onboarding") return null;
      return { to: GATE_HOME.onboarding, keep: inviteFromPath(pathname) };
    case "app":
      // The last onboarding step moves on to Home itself.
      if (first === "(auth)" || first === "age-check" || first === "account-blocked") {
        return { to: GATE_HOME.app, keep: null };
      }
      return null;
  }
}
