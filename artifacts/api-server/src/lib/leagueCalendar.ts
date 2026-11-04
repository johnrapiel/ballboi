// League dates (spec: Leagues). Dates are YYYY-MM-DD strings, the format
// leagues and rounds already use. Pure functions, so they're easy to test.
//
// Each round is one week: it starts on the season's start weekday (decision
// 29) and its deadline is the sixth day after. Then every league gets a fixed
// 1-week grace period (decision 25).

/**
 * A league runs on its creator's time zone, sent by their phone when they
 * start it (PR 4). Leagues made before then run on Eastern time, where Ball
 * Boi launched.
 */
export const DEFAULT_LEAGUE_TIME_ZONE = "America/New_York";

export const GRACE_DAYS = 7;

/** True for an IANA time zone name the server can use, like "America/Los_Angeles". */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The league's time zone, falling back to Eastern for a missing or unknown one. */
export function leagueZone(league: { timeZone?: string | null } | null | undefined): string {
  return isTimeZone(league?.timeZone) ? league!.timeZone! : DEFAULT_LEAGUE_TIME_ZONE;
}

/** Today's date in a time zone (Eastern unless given). */
export function leagueToday(now: Date = new Date(), timeZone: string = DEFAULT_LEAGUE_TIME_ZONE): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Today's date for a league, in its own time zone. */
export function todayFor(league: { timeZone?: string | null } | null | undefined, now: Date = new Date()): string {
  return leagueToday(now, leagueZone(league));
}

function clock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour") % 24, minute: n("minute"), second: n("second") };
}

/** The hour (0 to 23) on the clock in `timeZone` at `now`. */
export function localHour(now: Date, timeZone: string): number {
  return clock(now, timeZone).hour;
}

/** How far `timeZone` is ahead of UTC at instant `at`, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const c = clock(new Date(at), timeZone);
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant when the clock in `timeZone` reads `date` (YYYY-MM-DD) at `time` (HH:MM). */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset on either side of a daylight-saving change.
  let at = wall - offsetAt(wall, timeZone);
  at = wall - offsetAt(at, timeZone);
  return new Date(at);
}

/** The local date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDate(at: Date | string, timeZone: string): string {
  return leagueToday(new Date(at), timeZone);
}

/** Start (inclusive) and end (exclusive) of a local day in `timeZone`. */
export function dayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  return { from: zonedTime(date, "00:00", timeZone), to: zonedTime(addDays(date, 1), "00:00", timeZone) };
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** A 24-hour "HH:MM" time, like "18:30". */
export function isMatchTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** A weekday number, 0 (Sunday) to 6 (Saturday). */
export function isMatchDay(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6;
}

/**
 * The set time for a round's matches when the league has a weekly match day
 * and time (PR 4): the round's day that falls on that weekday, at that time in
 * the league's zone. Null when the league leaves times to the players.
 */
export function roundMatchTime(
  league: { matchDay?: number | null; matchTime?: string | null; timeZone?: string | null },
  round: { startDate: string; endDate: string },
): string | null {
  if (!isMatchDay(league.matchDay) || !isMatchTime(league.matchTime)) return null;
  for (let d = round.startDate; d <= round.endDate; d = addDays(d, 1)) {
    if (weekdayOf(d) === league.matchDay) return zonedTime(d, league.matchTime, leagueZone(league)).toISOString();
  }
  return null;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RoundWindow {
  roundNumber: number;
  /** First day of the round, on the season's start weekday. */
  startDate: string;
  /** Last day to play for standings. */
  deadline: string;
  /** Last day of the grace week: scores still count for Ball Boi stats. */
  graceEnd: string;
}

/** The dates for round `roundNumber` (1-based) of a season starting on `seasonStart`. */
export function roundWindow(seasonStart: string, roundNumber: number): RoundWindow {
  const startDate = addDays(seasonStart, (roundNumber - 1) * 7);
  const deadline = addDays(startDate, 6);
  return { roundNumber, startDate, deadline, graceEnd: addDays(deadline, GRACE_DAYS) };
}

/** The grace week's last day for a round whose deadline is `deadline`. */
export function graceEndFor(deadline: string): string {
  return addDays(deadline, GRACE_DAYS);
}

/** Every league locks to new joins once its season starts (decision 26). */
export function hasSeasonStarted(seasonStart: string | null | undefined, today: string): boolean {
  return !!seasonStart && today >= seasonStart;
}

export type RoundPhase = "draft" | "upcoming" | "open" | "grace" | "closed";

/** Where a round is in its week: not out yet, coming up, open, in the grace week, or closed. */
export function roundPhase(round: { publishedAt: Date | null; startDate: string; endDate: string }, today: string): RoundPhase {
  if (!round.publishedAt) return "draft";
  if (today < round.startDate) return "upcoming";
  if (today <= round.endDate) return "open";
  if (today <= graceEndFor(round.endDate)) return "grace";
  return "closed";
}

/** "Mon, Nov 2" for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
