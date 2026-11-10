import type { LeagueSchedule, ScheduleMatch, ScheduleRound } from "@workspace/api-client-react";

import { DOUBLE_DEFAULT_SCORE, flipScore, isDoubleDefault, WALKOVER_SCORE } from "./tennisScore";

// Helpers for the league schedule (spec: Leagues > Weekly loop, Scores and
// standings). Dates are YYYY-MM-DD in the league's time zone.

/** A YYYY-MM-DD date moved by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Thu, Nov 5" */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The phone's own time zone, like "America/Los_Angeles". */
export function phoneTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Leagues run on their creator's time zone (PR 4). When that isn't the
 * viewer's, a deadline names it: " PST", " ET". Empty when it's the same.
 */
export function zoneSuffix(timeZone: string | null | undefined, at: Date = new Date()): string {
  if (!timeZone) return "";
  const mine = phoneTimeZone();
  if (!mine || mine === timeZone) return "";
  const name = (tz: string) => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")
          ?.value ?? ""
      );
    } catch {
      return "";
    }
  };
  const theirs = name(timeZone);
  // Same clock under another name (New York and Toronto): nothing to say.
  if (!theirs || theirs === name(mine)) return "";
  return ` ${theirs}`;
}

/** "Thu, Nov 5" plus the league's time zone when it isn't the viewer's. */
export function deadlineDate(date: string, timeZone: string | null | undefined): string {
  return `${shortDate(date)}${zoneSuffix(timeZone)}`;
}

/** "7am" plus the league's time zone when it isn't the viewer's: when pairings go out. */
export function pairingTime(timeZone: string | null | undefined): string {
  return `7am${zoneSuffix(timeZone)}`;
}

/** True when an ISO time falls on the phone's today. */
export function isToday(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString();
}

/** "Today at 6:00 PM" or "Thu, Nov 5 at 6:00 PM", on the phone's clock. */
export function matchWhen(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isToday(iso, now)) return `Today at ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Tuesdays at 6:30 PM" for a league's weekly match day and "HH:MM" time, or null. */
export function weeklyMatchTime(matchDay: number | null | undefined, matchTime: string | null | undefined, timeZone?: string | null): string | null {
  if (matchDay == null || !matchTime) return null;
  const [h, m] = matchTime.split(":").map(Number);
  const clock = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${DAYS[matchDay]}s at ${clock}${zoneSuffix(timeZone)}`;
}

/** The instant when the clock in `timeZone` reads `date` (YYYY-MM-DD) at `time` (HH:MM). Mirrors the API's leagueCalendar. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (at: number) => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(new Date(at));
      const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute")) - Math.floor(at / 60000) * 60000;
    } catch {
      return -new Date(at).getTimezoneOffset() * 60000;
    }
  };
  let at = wall - offsetAt(wall);
  at = wall - offsetAt(at);
  return new Date(at);
}

/** "Nov 5 to 11" or "Nov 26 to Dec 2" */
export function dateRange(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  return `${month(s)} ${s.getUTCDate()} to ${sameMonth ? "" : `${month(e)} `}${e.getUTCDate()}`;
}

// Late matches (decision 152, John, Nov 8): an unplayed match gets one extra
// week after its round's deadline, and a result in that week doesn't change
// the standings (spec, Leagues). These are the words for it everywhere.

/** The one sentence under a late match that hasn't been played. */
export const LATE_NOTE = "This match's week has passed. You can still play it, but the result won't change the standings.";
/** A late match's played result on a result row. */
export const LATE_RESULT = "Not in standings";
/** A late match's played result in a round card. */
export const LATE_ROUND_RESULT = "Late: not in standings";

/** A late match's saved time, kept only while it's still ahead; a past time is dropped. */
export function lateTime(scheduledAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.getTime() > now.getTime() ? scheduledAt : null;
}

/** "Play by Fri, Nov 13" (the end of the extra week, in the league's zone). */
export function playByLine(graceEnd: string, timeZone: string | null | undefined): string {
  return `Play by ${deadlineDate(graceEnd, timeZone)}`;
}

/**
 * A late match's date line: its saved time while that's still ahead
 * ("Fri, Nov 13 at 6:30 PM"), else "Play by" the end of the extra week.
 * Never a past date as if it were upcoming.
 */
export function lateDateLine(
  scheduledAt: string | null | undefined,
  graceEnd: string,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return matchWhen(lateTime(scheduledAt, now), now) ?? playByLine(graceEnd, timeZone);
}

/** The line under a round's dates: when to play, and how long late matches have. Null once it's closed or the league has ended. */
export function roundPlayByLine(
  round: Pick<ScheduleRound, "phase" | "deadline" | "graceEnd">,
  timeZone: string | null | undefined,
  ended = false,
): string | null {
  if (ended) return null;
  const late = deadlineDate(round.graceEnd, timeZone);
  if (round.phase === "open" || round.phase === "upcoming") return `Play by ${deadlineDate(round.deadline, timeZone)}. Late matches can be played until ${late}.`;
  if (round.phase === "grace") return `Late matches can be played until ${late}. Their results don't change the standings.`;
  return null;
}

/** Short status for a round, always in words (never color alone). */
export function phaseLabel(phase: ScheduleRound["phase"]): string {
  switch (phase) {
    case "draft":
      return "Draft";
    case "upcoming":
      return "Next";
    case "open":
      return "This week";
    case "grace":
      return "Late matches";
    case "closed":
      return "Done";
    default:
      return phase;
  }
}

/** The other side: one name in singles, "Jo Park and Lee King" in doubles (D8). */
export function opponentName(m: ScheduleMatch, myPlayerId: number): string {
  const mine = onSide1(m, myPlayerId);
  const names = (mine ? [m.player2Name, m.player4Name] : [m.player1Name, m.player3Name]).filter((n): n is string => !!n);
  return names.join(" and ");
}

/** Doubles: side 1 is player1 + player3, side 2 is player2 + player4. */
function onSide1(m: Pick<ScheduleMatch, "player1Id"> & { player3Id?: number | null }, playerId: number): boolean {
  return m.player1Id === playerId || m.player3Id === playerId;
}

/** Each side's name: the player, or a doubles team ("John Rapiel & Sam Lee", D3). */
export function sideLabels(m: ScheduleMatch): { side1: string; side2: string } {
  const team = (a: string, b: string | null | undefined) => (b ? `${a} & ${b}` : a);
  return { side1: team(m.player1Name, m.player3Name), side2: team(m.player2Name, m.player4Name) };
}

export function isMine(m: ScheduleMatch, myPlayerId: number | null | undefined): boolean {
  return (
    myPlayerId != null &&
    (m.player1Id === myPlayerId || m.player2Id === myPlayerId || m.player3Id === myPlayerId || m.player4Id === myPlayerId)
  );
}

/** A stored score (player 1's side) as the given player sees it: their games first. RET and W/O stay. */
export function scoreForPlayer(score: string, m: Pick<ScheduleMatch, "player1Id"> & { player3Id?: number | null }, playerId: number): string {
  return onSide1(m, playerId) ? score : flipScore(score);
}

/** "6-3, 6-4" from the winner's side, or "by W/O" for a walkover (C18, Q5). */
export function winningScore(score: string, m: Pick<ScheduleMatch, "player1Id">, winnerId: number): string {
  return score.trim() === WALKOVER_SCORE ? `by ${WALKOVER_SCORE}` : scoreForPlayer(score, m, winnerId);
}

/**
 * C6: an unplayed match whose grace week has passed, or any unplayed match
 * once the league has ended (C24). It shows "Not played" and has no effect
 * on standings.
 */
export function isNotPlayed(round: Pick<ScheduleRound, "phase">, m: ScheduleMatch, ended = false): boolean {
  return (ended || round.phase === "closed") && !m.voided && m.status !== "completed";
}

/** "Alex Kim won 6-3, 6-4" from the winner's side, or a status in words. */
export function resultLine(m: ScheduleMatch, round?: Pick<ScheduleRound, "phase">, ended = false): string {
  if (m.voided) return "Cancelled";
  if (round && isNotPlayed(round, m, ended)) return "Not played";
  // Doubles (John, Nov 9): both teams a player short, so no winner.
  if (m.status === "completed" && isDoubleDefault(m.score)) return DOUBLE_DEFAULT_SCORE;
  if (m.status !== "completed" || !m.score || m.winnerId == null) return ended ? "Not played" : "Not played yet";
  const { side1, side2 } = sideLabels(m);
  const winner = m.winnerId === m.player1Id || m.winnerId === m.player3Id ? side1 : side2;
  return `${winner} won ${winningScore(m.score, m, m.winnerId)}`;
}

export interface MyWeek {
  round: ScheduleRound;
  match: ScheduleMatch | null;
  bye: boolean;
}

/**
 * The round the player should act on: this week's, else a grace-week match
 * still waiting for a score, else next week's.
 */
export function myWeek(schedule: LeagueSchedule | undefined, myPlayerId: number | null | undefined): MyWeek | null {
  if (!schedule || myPlayerId == null) return null;
  const out = schedule.rounds.filter((r) => r.phase !== "draft");
  const find = (r: ScheduleRound): MyWeek | null => {
    const match = r.matches.find((m) => isMine(m, myPlayerId) && !m.voided) ?? null;
    const bye = r.byes.some((b) => b.playerId === myPlayerId);
    return match || bye ? { round: r, match, bye } : null;
  };
  const graceOpen = out.find((r) => r.phase === "grace" && r.matches.some((m) => isMine(m, myPlayerId) && !m.voided && m.status !== "completed"));
  const current = out.find((r) => r.phase === "open");
  const next = out.find((r) => r.phase === "upcoming");
  for (const r of [current, graceOpen, next]) {
    if (!r) continue;
    const week = find(r);
    if (week) return week;
  }
  return null;
}

/** Whether a match can be scored now: it's out, unplayed, not voided, not past its grace week, and the league is still on. */
export function canEnterScore(round: ScheduleRound, m: ScheduleMatch, ended = false): boolean {
  return !ended && (round.phase === "open" || round.phase === "grace") && m.status !== "completed" && !m.voided;
}

/**
 * League detail's "Record with Ball Boi" (John, Nov 8, option A). Any day of
 * the match's week, grace week included, while the match can be scored:
 * "record" on a singles match, "doubles" (dimmed, with the reason) on a
 * doubles one. Null once the score is in, or the round is upcoming, closed,
 * voided, or the league has ended: the same rules as Enter score.
 */
export function recordAction(
  round: ScheduleRound,
  m: ScheduleMatch,
  ended: boolean,
  doubles: boolean,
): "record" | "doubles" | null {
  if (!canEnterScore(round, m, ended) || !!m.score) return null;
  return doubles ? "doubles" : "record";
}

/** C21: the playoff line under the standings, or null with no playoffs. */
export function playoffLine(playoffSize: number | null | undefined, activePlayers: number): string | null {
  if (!playoffSize) return null;
  if (activePlayers < 4) return "Not enough players for playoffs this season.";
  return `Top ${activePlayers >= 8 && playoffSize >= 8 ? 8 : 4} make the playoffs.`;
}

/** C5: "Corrected by Sam Lee on Nov 6", shown to both players and in Manage. */
export function correctionLine(m: Pick<ScheduleMatch, "correctedBy" | "correctedAt">): string | null {
  if (!m.correctedBy || !m.correctedAt) return null;
  const on = new Date(m.correctedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Corrected by ${m.correctedBy} on ${on}`;
}

/** Finding 7: "Score edited by Sam Lee", shown to both players once either edits it. */
export function editedLine(m: Pick<ScheduleMatch, "editedBy">): string | null {
  return m.editedBy ? `Score edited by ${m.editedBy}` : null;
}

/**
 * The days a match time can be picked in (finding 10): today through the
 * round's last day, never days already past. Dates are YYYY-MM-DD in the
 * league's time zone. Null when the whole round is past.
 */
export function pickableDays(startDate: string, lastDay: string, today: string): { first: string; last: string } | null {
  const first = today > startDate ? today : startDate;
  return first > lastDay ? null : { first, last: lastDay };
}
