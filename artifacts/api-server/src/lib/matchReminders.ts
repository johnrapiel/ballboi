// Match day reminders: one rule everywhere (Wave 2, Session G; spec: Leagues >
// Reminders; decision 127). Pure, so the rule is tested without a database or
// a clock; services/push/matchReminderJob.ts runs it.
//
// - Any match with a set date and time, league or Discover, gets:
//   - the day-before reminder at 8 AM on the match's clock, and
//   - one 2 hours before.
// - A league match with no set time gets the Sunday "your match this week"
//   nudge instead.
// - Each is claimed in match_reminders_log before it's sent, so it goes out at
//   most once, however often the job runs. A match moved to a new time gets
//   its reminders again for the new time.
// - All of it sits behind Settings > Notifications > Match day reminders, on
//   by default. The older per-league-row switch is still honored.
// - There's no Wednesday "set your availability" reminder any more.

import { addDays, localDate, localHour } from "./leagueCalendar.js";

export const DAY_BEFORE_HOUR = 8;
export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
/** Sunday, as Date.getUTCDay() counts on a YYYY-MM-DD date. */
export const NUDGE_WEEKDAY = 0;
export const NUDGE_HOUR = 9;

export type ReminderType = "day_before_match" | "two_hours_before" | "week_nudge";

export interface TimedMatch {
  id: number;
  scheduledAt: Date;
  /** The match's clock: its league's time zone, or the match card's. */
  timeZone: string;
}

export interface DueReminder {
  matchId: number;
  type: ReminderType;
  /** Part of the at-most-once key: the match's date (day before), its start (2 hours), or the Sunday (nudge). */
  key: string;
}

/**
 * The reminders due now for a match with a set time. The day-before one is
 * due during the 8 AM hour, on the match's clock, the day before it. The
 * 2-hour one is due from 2 hours before until it starts, so a match added
 * less than 2 hours ahead still gets it once.
 */
export function dueForTimedMatch(m: TimedMatch, now: Date): DueReminder[] {
  const start = m.scheduledAt.getTime();
  if (Number.isNaN(start) || now.getTime() >= start) return [];
  const out: DueReminder[] = [];
  const matchDay = localDate(m.scheduledAt, m.timeZone);
  if (localHour(now, m.timeZone) === DAY_BEFORE_HOUR && localDate(now, m.timeZone) === addDays(matchDay, -1)) {
    out.push({ matchId: m.id, type: "day_before_match", key: matchDay });
  }
  if (now.getTime() >= start - TWO_HOURS_MS) {
    out.push({ matchId: m.id, type: "two_hours_before", key: m.scheduledAt.toISOString() });
  }
  return out;
}

/** True during the Sunday nudge hour on this clock. Returns that Sunday's date, or null. */
export function nudgeSunday(now: Date, timeZone: string): string | null {
  const today = localDate(now, timeZone);
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== NUDGE_WEEKDAY) return null;
  return localHour(now, timeZone) === NUDGE_HOUR ? today : null;
}

/**
 * A league match with no set time is nudged on the Sunday before (or during)
 * its round's week: its round is out and runs into the coming week.
 */
export function wantsWeekNudge(round: { startDate: string; endDate: string; published: boolean }, sunday: string): boolean {
  if (!round.published) return false;
  const weekEnd = addDays(sunday, 7);
  return round.startDate <= weekEnd && round.endDate > sunday;
}

export interface ReminderPlayer {
  clerkUserId: string | null;
  /** The older per-league-row switch. */
  dayBeforeMatchReminderEnabled?: boolean | null;
}

/** Accounts to remind, leaving out anyone who turned Match day reminders off. Once each. */
export function remindedUserIds(players: (ReminderPlayer | null | undefined)[], turnedOff: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const p of players) {
    if (!p?.clerkUserId || p.dayBeforeMatchReminderEnabled === false) continue;
    if (turnedOff.has(p.clerkUserId) || ids.includes(p.clerkUserId)) continue;
    ids.push(p.clerkUserId);
  }
  return ids;
}

/** "6 PM" or "6:30 PM" on the match's clock. */
export function clockLabel(at: Date, timeZone: string): string {
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(":00", "");
}

export function reminderCopy(
  type: ReminderType,
  input: { opponents: string; at: Date | null; timeZone: string; place: string | null; byDate?: string | null },
): { title: string; body: string } {
  const where = input.place ? ` at ${input.place}` : "";
  const vs = input.opponents ? `vs ${input.opponents}` : "Your match";
  if (type === "week_nudge") {
    const by = input.byDate ? ` by ${new Date(`${input.byDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` : "";
    return { title: "Your match this week", body: `${vs}. Set a time together${by}.` };
  }
  const time = input.at ? clockLabel(input.at, input.timeZone) : "";
  if (type === "day_before_match") return { title: "Match tomorrow", body: `${vs}, ${time}${where}.` };
  return { title: "Your match is in 2 hours", body: `${vs}, ${time}${where}.` };
}
