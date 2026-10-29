// Entering a league score (spec: Leagues > Scores and standings).
//
// - Either player enters the score. The first score entered stands: there's no
//   confirm or dispute step (decision 24).
// - A match scored in the week after its round's deadline is a grace-week
//   match: it counts for Ball Boi stats, not standings (decision 25; ratings
//   don't move on results, per the Oct 29 Ball Boi Rating decision).
//   After the grace week, the match can't be scored.
//
// Pure functions, so they're easy to test.

import { parseSet } from "./scoringUtils.js";
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
}): ScoreCheck {
  const { match, round, today } = input;
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled when a player left the league." };
  if (match.status === "completed") {
    return { ok: false, status: 409, error: "A score is already in for this match. The first score entered stands." };
  }
  const players = matchParticipantIds(match);
  if (!input.callerPlayerIds.some((id) => players.includes(id))) {
    return { ok: false, status: 403, error: "Only the players in this match can enter its score." };
  }
  // Playoff matches aren't tied to a weekly round.
  if (match.playoffBracketId || !round) return { ok: true, inGrace: false };

  if (!round.publishedAt) return { ok: false, status: 409, error: "This round's pairings haven't gone out yet." };
  if (today < round.startDate) {
    return { ok: false, status: 409, error: `This match opens on ${shortDate(round.startDate)}.` };
  }
  const graceEnd = graceEndFor(round.endDate);
  if (today > graceEnd) {
    return { ok: false, status: 409, error: `The grace week for this match ended on ${shortDate(graceEnd)}.` };
  }
  return { ok: true, inGrace: today > round.endDate };
}

export type ScoreParse =
  | { ok: true; score: string; winnerSide: 1 | 2 }
  | { ok: false; error: string };

/**
 * Reads a score written from player 1's (team 1's) side, like "6-3, 4-6, 10-7".
 * Returns the tidied score and which side won.
 */
export function parseMatchScore(raw: string): ScoreParse {
  const sets = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (sets.length === 0) return { ok: false, error: "Enter the score for each set, like 6-4." };
  if (sets.length > 5) return { ok: false, error: "A match has at most 5 sets." };
  let side1 = 0;
  let side2 = 0;
  for (const set of sets) {
    const parsed = parseSet(set);
    if (!parsed) return { ok: false, error: `"${set}" isn't a set score. Use a format like 6-4.` };
    if (parsed.myGames < 0 || parsed.oppGames < 0) return { ok: false, error: `"${set}" isn't a set score.` };
    if (parsed.myGames === parsed.oppGames) return { ok: false, error: `"${set}" is tied. Every set needs a winner.` };
    if (parsed.myGames > parsed.oppGames) side1++;
    else side2++;
  }
  if (side1 === side2) {
    return { ok: false, error: "The sets are tied. If you played a match tiebreak, add it as the last set (like 10-7)." };
  }
  return { ok: true, score: sets.join(", "), winnerSide: side1 > side2 ? 1 : 2 };
}

/** The winning player's id. Doubles store the team by its first player (player1 or player2). */
export function winnerIdFor(match: ScoreableMatch, side: 1 | 2): number {
  return side === 1 ? match.player1Id : match.player2Id;
}

/** Score as the player on `side` sees it: their games first. */
export function scoreFromSide(score: string, side: 1 | 2): string {
  if (side === 1) return score;
  return score
    .split(",")
    .map((set) => {
      const m = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ""}` : set.trim();
    })
    .join(", ");
}
