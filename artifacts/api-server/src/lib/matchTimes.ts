// Who can set a league match's time, and when (PR 4: League match times).
// Pure, so it's easy to test.
//
// A club league sets one weekly match day and time for everyone; only its
// admins can move a match. In a league with no set time, either player in a
// match (or a league admin) picks a date and time inside that match's week.

import { graceEndFor, isMatchDay, isMatchTime, leagueZone, localDate, roundPhase, shortDate, todayFor } from "./leagueCalendar.js";

export interface MatchTimeInput {
  league: { timeZone: string | null; matchDay: number | null; matchTime: string | null; endedAt: Date | null };
  match: {
    player1Id: number;
    player2Id: number;
    player3Id: number | null;
    player4Id: number | null;
    status: string;
    score: string | null;
    voidedAt: Date | null;
    roundId: number | null;
  };
  round: { startDate: string; endDate: string; publishedAt: Date | null } | null;
  /** What the phone sent: an ISO date and time, or null to clear it. */
  scheduledAt: unknown;
  /** The caller's active player rows in this league. */
  callerPlayerIds: number[];
  isAdmin: boolean;
  now: Date;
}

export type MatchTimeCheck =
  | { ok: true; scheduledAt: string | null }
  | { ok: false; status: number; error: string };

/** True when the league has a weekly match day and time set by an admin. */
export function hasSetMatchTime(league: { matchDay: number | null; matchTime: string | null }): boolean {
  return isMatchDay(league.matchDay) && isMatchTime(league.matchTime);
}

export function checkMatchTime(input: MatchTimeInput): MatchTimeCheck {
  const { league, match, round, isAdmin } = input;
  const sides = [match.player1Id, match.player2Id, match.player3Id, match.player4Id];
  const isPlayer = input.callerPlayerIds.some((id) => sides.includes(id));
  if (!isPlayer && !isAdmin) {
    return { ok: false, status: 403, error: "Only the players in this match or a league admin can set its time." };
  }
  if (league.endedAt) return { ok: false, status: 409, error: "This league has ended." };
  if (hasSetMatchTime(league) && !isAdmin) {
    return { ok: false, status: 403, error: "This league plays at a set time each week. Ask an admin to change it." };
  }
  if (match.voidedAt) return { ok: false, status: 409, error: "This match was cancelled." };
  if (match.status === "completed" || match.score) return { ok: false, status: 409, error: "This match has been played." };
  if (!match.roundId || !round) return { ok: false, status: 409, error: "Only weekly league matches can have a time set here." };

  const phase = roundPhase(round, todayFor(league, input.now));
  if (phase === "draft") return { ok: false, status: 409, error: "This round hasn't gone out to players yet." };
  if (phase === "closed") return { ok: false, status: 409, error: "This match's week is over." };

  if (input.scheduledAt === null) return { ok: true, scheduledAt: null };
  const at = typeof input.scheduledAt === "string" ? new Date(input.scheduledAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { ok: false, status: 400, error: "Pick a date and time." };

  // The match's week, in the league's time zone. Once the deadline passes,
  // the grace week is the time left to play.
  const last = phase === "grace" ? graceEndFor(round.endDate) : round.endDate;
  const day = localDate(at, leagueZone(league));
  if (day < round.startDate || day > last) {
    return { ok: false, status: 400, error: `Pick a day from ${shortDate(round.startDate)} to ${shortDate(last)}.` };
  }
  return { ok: true, scheduledAt: at.toISOString() };
}

/** Checks an admin's weekly match day and time: both set, or both cleared. */
export function checkLeagueMatchTime(body: { matchDay?: unknown; matchTime?: unknown }):
  | { ok: true; matchDay: number | null; matchTime: string | null }
  | { ok: false; error: string } {
  const day = body.matchDay ?? null;
  const time = body.matchTime ?? null;
  if (day === null && time === null) return { ok: true, matchDay: null, matchTime: null };
  if (!isMatchDay(day)) return { ok: false, error: "Pick a match day." };
  if (!isMatchTime(time)) return { ok: false, error: "Pick a match time, like 18:30." };
  return { ok: true, matchDay: day, matchTime: time };
}
