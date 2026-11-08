// Opponent notice and "Was that you?" (Wave 2, Session G; spec: Ball Boi >
// Match notification; decisions 85 and 124).
//
// When the mounted phone starts capturing, the other players hear about it:
// - League mates, accepted Discover matches, and Quick matches against
//   someone you already play: "Ball Boi is recording your match", at most
//   once per match and person. None during the beta (decision 85).
// - A Quick match against a stranger (someone found in player search you've
//   never played or shared a league or match card with): the match is made
//   against an unlinked stand-in, and the stranger gets "[Name] recorded a
//   match with you. Was that you?" with Yes and Not me. Until Yes nothing
//   from the match shows on their profile. Sent at most once.
// - Placeholders (not on Ball Boi) get nothing in the app; they have the
//   invite link.

import type { OpponentRequestStatus } from "@workspace/db";

export const OPPONENT_NOTICE_TITLE = "Ball Boi is recording your match";

export function opponentNoticeBody(recorderName: string): string {
  return `${recorderName.trim() || "Your opponent"} started recording your match.`;
}

export function wasThatYouBody(recorderName: string): string {
  return `${recorderName.trim() || "A player"} recorded a match with you. Was that you?`;
}

export interface MatchPerson {
  clerkUserId: string | null;
}

export interface PendingRequest {
  code: string;
  opponentClerkUserId: string;
  status: OpponentRequestStatus;
  notifiedAt: Date | null;
}

export interface NoticePlan {
  /** Accounts that get "Ball Boi is recording your match" (before the at-most-once log). */
  notice: string[];
  /** The "Was that you?" request to send, if any. */
  request: { code: string; to: string } | null;
}

/** Who hears what when recording starts. Pure, so the rules are tested without a database. */
export function planOpponentNotices(input: {
  recorderId: string;
  players: MatchPerson[];
  request: PendingRequest | null;
  beta: boolean;
}): NoticePlan {
  const request =
    input.request && input.request.status === "pending" && !input.request.notifiedAt && input.request.opponentClerkUserId !== input.recorderId
      ? { code: input.request.code, to: input.request.opponentClerkUserId }
      : null;
  const notice: string[] = [];
  if (!input.beta) {
    for (const p of input.players) {
      const id = p.clerkUserId;
      if (!id || id === input.recorderId || notice.includes(id)) continue;
      // The stranger hears only the request; nobody else on the match is unlinked to them.
      if (input.request && id === input.request.opponentClerkUserId) continue;
      notice.push(id);
    }
  }
  return { notice, request };
}

/**
 * A Quick match opponent picked from player search is a stranger unless you
 * share a league, have played before, or have an accepted match card.
 */
export function isStranger(input: { opponentClerkUserId: string; connected: Set<string>; acceptedPlanWith: Set<string> }): boolean {
  return !input.connected.has(input.opponentClerkUserId) && !input.acceptedPlanWith.has(input.opponentClerkUserId);
}

/** What an answer does to a pending request. */
export function answerRequest(
  status: OpponentRequestStatus,
  answer: "yes" | "not_me",
): { ok: true; status: OpponentRequestStatus } | { ok: false; error: string } {
  if (status === answer) return { ok: true, status };
  if (status !== "pending") {
    return { ok: false, error: status === "yes" ? "This match is already on your profile." : "You said this wasn't you." };
  }
  return { ok: true, status: answer };
}

/** Not me: the stand-in keeps a plain name, so the stranger's name leaves the recorder's match. */
export const NOT_ME_NAME = "Opponent";
