// Which of a player's matches Ball Boi can record right now.
//
// Spec (Ball Boi > Recording): "Every recording starts from a match." The Ball
// Boi tab's "Record a match" lists today's matches first, then Quick match.
//
// PR 4 (John's decisions): any unplayed league match in its round's week,
// grace week included, can be recorded any day that week, with or without a
// set time. A set time only moves it to the top on its day. Quick matches
// still show on the day they're scheduled.

import { graceEndFor, leagueZone, roundPhase, todayFor } from "./leagueCalendar.js";

export interface MatchRow {
  id: number;
  leagueId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  status: string;
  scheduledAt: string | null;
  location: string | null;
  roundId?: number | null;
  playoffBracketId?: number | null;
  score?: string | null;
  voidedAt?: Date | null;
}

export interface RecordableMatch {
  id: number;
  scheduledAt: string | null;
  location: string | null;
  leagueId: number | null;
  leagueName: string | null;
  format: "singles" | "doubles";
  /** The other side: "Alex Kim", or "Alex Kim and Sam Lee" in doubles. */
  opponentName: string;
  /** Your doubles partner, when there is one. */
  partnerName: string | null;
  /** Last day to play a league round match (YYYY-MM-DD, the league's zone): the deadline, or the grace week's end. */
  playBy: string | null;
  /** The league's time zone, for playBy. Null for a Quick match. */
  timeZone: string | null;
}

/** What the server knows about a match's round, league and bracket. */
export interface RecordContext {
  now: Date;
  /** The viewer's local day, from their phone. */
  from: Date;
  to: Date;
  rounds: Map<number, { startDate: string; endDate: string; publishedAt: Date | null }>;
  leagues: Map<number, { name: string; timeZone: string | null; endedAt: Date | null }>;
  /** Playoff brackets still being played. */
  activeBrackets: Set<number>;
}

/** Statuses that mean the match is over or off. */
const DONE = new Set(["completed", "cancelled", "canceled", "voided", "forfeit"]);

/** True when the match is scheduled inside [from, to) and hasn't been played. */
export function isRecordableToday(m: MatchRow, from: Date, to: Date): boolean {
  if (DONE.has(m.status)) return false;
  if (!m.scheduledAt) return false;
  const at = new Date(m.scheduledAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= from.getTime() && at < to.getTime();
}

/** Not played, not cancelled, no score in. */
function unplayed(m: MatchRow): boolean {
  return !DONE.has(m.status) && !m.score && !m.voidedAt;
}

/**
 * True when Ball Boi can record this match now:
 * - a league round match while its round is out and this week (grace week
 *   included), in the league's own time zone, whether or not it has a time;
 * - a playoff match while its bracket is being played;
 * - anything else (Quick match) on the day it's scheduled.
 * Never once a score is in, and never in a league that has ended.
 */
export function isRecordableNow(m: MatchRow, ctx: RecordContext): boolean {
  if (!unplayed(m)) return false;
  if (m.leagueId != null) {
    const league = ctx.leagues.get(m.leagueId);
    if (!league || league.endedAt) return false;
    if (m.roundId != null) {
      const round = ctx.rounds.get(m.roundId);
      if (!round) return false;
      const phase = roundPhase(round, todayFor(league, ctx.now));
      return phase === "open" || phase === "grace";
    }
    if (m.playoffBracketId != null) return ctx.activeBrackets.has(m.playoffBracketId);
  }
  return isRecordableToday(m, ctx.from, ctx.to);
}

/** The last day to play a round match, in its league's zone: the deadline, or the grace week's end once that's passed. */
export function playByFor(m: MatchRow, ctx: RecordContext): { playBy: string | null; timeZone: string | null } {
  const league = m.leagueId != null ? ctx.leagues.get(m.leagueId) : undefined;
  const round = m.roundId != null ? ctx.rounds.get(m.roundId) : undefined;
  if (!league) return { playBy: null, timeZone: null };
  const timeZone = leagueZone(league);
  if (!round) return { playBy: null, timeZone };
  const grace = roundPhase(round, todayFor(league, ctx.now)) === "grace";
  return { playBy: grace ? graceEndFor(round.endDate) : round.endDate, timeZone };
}

/**
 * Describes a match from the viewer's side. `myPlayerIds` are every player row
 * linked to the viewer (one account can have one per league).
 */
export function toRecordableMatch(
  m: MatchRow,
  myPlayerIds: number[],
  names: Record<number, string>,
  leagueNames: Record<number, string>,
): RecordableMatch | null {
  const mine = new Set(myPlayerIds);
  const doubles = m.player3Id != null && m.player4Id != null;
  // Sides: player1 + player3 against player2 + player4.
  const sideA = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
  const sideB = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
  const onA = sideA.some((id) => mine.has(id));
  const onB = sideB.some((id) => mine.has(id));
  if (!onA && !onB) return null;
  const mySide = onA ? sideA : sideB;
  const theirSide = onA ? sideB : sideA;
  const name = (id: number) => names[id] ?? "Opponent";
  const partner = mySide.find((id) => !mine.has(id));
  return {
    id: m.id,
    scheduledAt: m.scheduledAt,
    location: m.location,
    leagueId: m.leagueId,
    leagueName: m.leagueId != null ? (leagueNames[m.leagueId] ?? null) : null,
    format: doubles ? "doubles" : "singles",
    opponentName: theirSide.map(name).join(" and "),
    partnerName: doubles && partner != null ? name(partner) : null,
    playBy: null,
    timeZone: null,
  };
}

/** Earliest first; matches with no time go last. */
export function byScheduledTime(a: RecordableMatch, b: RecordableMatch): number {
  const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
  const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
  return ta - tb;
}

/**
 * "Record a match" order: a match with a set time on the viewer's day comes
 * first (earliest first), then the rest of the week's matches by time, with
 * untimed ones last.
 */
export function recordListOrder(from: Date, to: Date) {
  const today = (m: RecordableMatch) => {
    if (!m.scheduledAt) return false;
    const at = new Date(m.scheduledAt).getTime();
    return at >= from.getTime() && at < to.getTime();
  };
  return (a: RecordableMatch, b: RecordableMatch): number => Number(today(b)) - Number(today(a)) || byScheduledTime(a, b);
}

/** Reads a `from`/`to` query value as a date, or null when it isn't one. */
export function parseWhen(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** What the Ball Boi tab's processing card says about a server recording. */
export type RecordingStage = "uploading" | "analyzing" | "ready" | "failed";

/**
 * Maps a session's status to the card's stage. "recording" on the server means
 * the phone made the session but the upload hasn't finished.
 */
export function recordingStage(status: string, processingStatus: string): RecordingStage {
  if (status === "completed" || processingStatus === "completed") return "ready";
  if (status === "failed" || processingStatus === "failed") return "failed";
  if (status === "processing" || processingStatus === "processing") return "analyzing";
  return "uploading";
}
