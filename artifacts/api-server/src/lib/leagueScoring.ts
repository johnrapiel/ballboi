// Entering a league score (spec: Leagues > Scores and standings).
//
// - Either player enters the score. There's no confirm or dispute step
//   (decision 24). Either player can edit it for 24 hours after; then it
//   locks and only the league admin can correct it (finding 7, Nov 6).
// - A match scored in the week after its round's deadline is a grace-week
//   match: it counts for Ball Boi stats, not standings (decision 25; ratings
//   don't move on results, per the Oct 29 Ball Boi Rating decision).
//   After the grace week, the match can't be scored.
//
// Pure functions, so they're easy to test.

import { checkTennisScore, flipScore, RETIRED_SUFFIX } from "./tennisScore.js";
import { graceEndFor, shortDate } from "./leagueCalendar.js";

export interface ScoreableMatch {
  status: string;
  voidedAt: Date | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  playoffBracketId: number | null;
}

export interface ScoreableRound {
  startDate: string;
  endDate: string;
  publishedAt: Date | null;
}

export type ScoreCheck =
  | { ok: true; inGrace: boolean }
  | { ok: false; status: number; error: string };

export function matchParticipantIds(m: ScoreableMatch): number[] {
  return [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null);
}

/** Whether a caller who owns `callerPlayerIds` can enter a score for this match today. */
export function checkScoreEntry(input: {
  match: ScoreableMatch;
  round: ScoreableRound | null;
  today: string;
  callerPlayerIds: number[];
  /** A playoff match's last day to play (Q5b), when its league has one. */
  playoffPlayBy?: string | null;
}): ScoreCheck {
  const { match, round, today } = input;
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled when a player left the league." };
  if (match.status === "completed") {
    return { ok: false, status: 409, error: "A score is already in for this match. Either player can edit it from the match for 24 hours." };
  }
  const players = matchParticipantIds(match);
  if (!input.callerPlayerIds.some((id) => players.includes(id))) {
    return { ok: false, status: 403, error: "Only the players in this match can enter its score." };
  }
  // Playoff rounds get two weeks, a play week and a grace week (Q5b). After
  // that the admin enters the result or a walkover.
  if (match.playoffBracketId) {
    if (input.playoffPlayBy && today > input.playoffPlayBy) {
      return {
        ok: false,
        status: 409,
        error: `The play-by date for this match was ${shortDate(input.playoffPlayBy)}. Your league admin can enter the result.`,
      };
    }
    return { ok: true, inGrace: false };
  }
  if (!round) return { ok: true, inGrace: false };

  if (!round.publishedAt) return { ok: false, status: 409, error: "This round's pairings haven't gone out yet." };
  if (today < round.startDate) {
    return { ok: false, status: 409, error: `This match opens on ${shortDate(round.startDate)}.` };
  }
  const graceEnd = graceEndFor(round.endDate);
  if (today > graceEnd) {
    return { ok: false, status: 409, error: `This match can't be scored now. The last day to play it was ${shortDate(graceEnd)}.` };
  }
  return { ok: true, inGrace: today > round.endDate };
}

export type ScoreParse =
  | { ok: true; score: string; winnerSide: 1 | 2 }
  | { ok: false; error: string };

/**
 * Reads a score written from player 1's (team 1's) side, like "6-3, 4-6, 10-7".
 * Only real tennis scores pass (C10, lib/tennisScore.ts). With `retired`, the
 * other side stopped mid-match: side 1 wins and the score ends in RET (Q6).
 * Returns the tidied score and which side won.
 */
export function parseMatchScore(raw: string, opts: { retired?: boolean } = {}): ScoreParse {
  const check = checkTennisScore(raw, opts);
  if (!check.ok) return check;
  const score = check.sets.join(", ") + (opts.retired ? RETIRED_SUFFIX : "");
  return { ok: true, score, winnerSide: check.winnerSide };
}

/** The winning player's id. Doubles store the team by its first player (player1 or player2). */
export function winnerIdFor(match: ScoreableMatch, side: 1 | 2): number {
  return side === 1 ? match.player1Id : match.player2Id;
}

/** Score as the player on `side` sees it: their games first. RET and W/O carry over. */
export function scoreFromSide(score: string, side: 1 | 2): string {
  return side === 1 ? score : flipScore(score);
}
