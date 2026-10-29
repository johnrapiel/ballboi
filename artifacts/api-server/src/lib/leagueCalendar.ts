// League dates (spec: Leagues). Dates are YYYY-MM-DD strings, the format
// leagues and rounds already use. Pure functions, so they're easy to test.
//
// Each round is one week: it starts on the season's start weekday (decision
// 29) and its deadline is the sixth day after. Then every league gets a fixed
// 1-week grace period (decision 25).

/**
 * Leagues don't store a time zone yet, so "today" for a league is the date on
 * the US East Coast, where Ball Boi launches. A league time zone, from the
 * admin's home area, is a follow-up once home areas exist.
 */
export const LEAGUE_TIME_ZONE = "America/New_York";

export const GRACE_DAYS = 7;

/** Today's date in the league time zone. */
export function leagueToday(now: Date = new Date(), timeZone: string = LEAGUE_TIME_ZONE): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
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
  /** Last day of the grace week: scores still count for ratings and stats. */
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

/** "Mon, Nov 2" for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
