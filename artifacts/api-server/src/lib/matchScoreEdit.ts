// Editing the score of a Discover or Quick match (decision 151, John, Nov 8).
// The same 24 hours as a league score (decision 100): either player edits it
// from their own side, from the pencil on Match detail, and the latest edit
// stands. There is no league, so there are no standings or league records to
// move, and no admin to correct it afterwards: after 24 hours it's locked.
// League matches keep POST /leagues/:leagueId/matches/:matchId/score/edit.
// Pure, so it's tested in __tests__/matchDetailEdit.test.ts.

import { checkEdit, EDIT_LOCKED_MESSAGE, type ChangeableMatch } from "./leagueScoreChanges.js";
import { flipScore, parseSideScore } from "./quickMatch.js";

/** The footnote's words, with no admin to point to. */
export const CASUAL_LOCKED_MESSAGE = "Scores lock 24 hours after they're entered.";

export interface CasualEditMatch extends ChangeableMatch {
  leagueId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
}

export type CasualEdit =
  | { ok: true; score: string; winnerId: number; yourScore: string }
  | { ok: false; status: number; error: string };

/**
 * Whether `userId` (who owns `myPlayerIds`) can change this Discover or Quick
 * match's score to `raw`, written from their side, and what to store.
 * `accounts` are the Clerk ids of everyone in the match.
 */
export function planCasualEdit(input: {
  match: CasualEditMatch;
  userId: string;
  accounts: string[];
  myPlayerIds: number[];
  raw: unknown;
  now: Date;
}): CasualEdit {
  const { match: m } = input;
  if (m.leagueId != null) return { ok: false, status: 404, error: "Match not found" };
  const check = checkEdit(m, input.userId, input.accounts, input.now);
  if (!check.ok) {
    if (check.error === EDIT_LOCKED_MESSAGE) return { ok: false, status: 409, error: CASUAL_LOCKED_MESSAGE };
    // Admin wording never applies outside a league.
    if (/league admin/i.test(check.error)) return { ok: false, status: 409, error: "This score can't be edited." };
    return check;
  }
  const parsed = parseSideScore(input.raw);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const mine = new Set(input.myPlayerIds);
  const side: 1 | 2 = mine.has(m.player1Id) || (m.player3Id != null && mine.has(m.player3Id)) ? 1 : 2;
  // Stored from player 1's side, like every other match.
  const score = side === 1 ? parsed.score : flipScore(parsed.score);
  const winnerSide: 1 | 2 = side === 1 ? parsed.winnerSide : parsed.winnerSide === 1 ? 2 : 1;
  return { ok: true, score, winnerId: winnerSide === 1 ? m.player1Id : m.player2Id, yourScore: parsed.score };
}
