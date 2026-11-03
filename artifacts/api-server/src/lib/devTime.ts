// Dev-only time controls for a league, for walkthroughs and testing. Never
// available in production. Pure rules, so they're easy to test.
//
// Nothing fakes the clock. A "time jump" moves the league's dates earlier by
// some number of days (season, rounds, scheduled matches), which is the same
// as the calendar moving forward for that league only. Every other rule
// (join lock, grace week, standings) then behaves exactly as it would on that
// day, because it reads the same dates.

import { addDays, graceEndFor } from "./leagueCalendar.js";

export const TIME_ACTIONS = ["season_started", "deadline_passed", "in_grace", "grace_over"] as const;
export type TimeAction = (typeof TIME_ACTIONS)[number];

/** True when dev tools may run: never in production, never on a live Clerk instance. */
export function devToolsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  if ((env.CLERK_SECRET_KEY ?? "").startsWith("sk_live_")) return false;
  return true;
}

/** Whole days from `from` to `to` (YYYY-MM-DD); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface TimeRound {
  roundNumber: number;
  startDate: string;
  endDate: string;
  published: boolean;
}

export type ShiftPlan = { days: number; message: string } | { error: string };

/**
 * The round the grace-week controls act on: the latest round that's out and
 * has started, else the first round that's out.
 */
export function targetRound(rounds: TimeRound[], today: string): TimeRound | null {
  const out = rounds.filter((r) => r.published).sort((a, b) => a.roundNumber - b.roundNumber);
  const started = out.filter((r) => r.startDate <= today);
  return started[started.length - 1] ?? out[0] ?? null;
}

/** How many days to move the league earlier for `action`. */
export function planShift(action: TimeAction, input: { today: string; startDate: string | null; rounds: TimeRound[] }): ShiftPlan {
  const { today } = input;
  if (!input.startDate) return { error: "This league has no start date." };

  if (action === "season_started") {
    const days = daysBetween(today, input.startDate);
    if (days <= 0) return { error: "The season has already started." };
    return { days, message: "The season starts today. New players now go to the waitlist." };
  }

  const round = targetRound(input.rounds, today);
  if (!round) return { error: "No round has gone out yet. Run Flex pairing, then send the round to players first." };

  // Where the round's deadline should land, relative to today.
  const newDeadline =
    action === "deadline_passed" ? addDays(today, -1) : action === "in_grace" ? addDays(today, -4) : addDays(today, -8);
  const days = daysBetween(newDeadline, round.endDate);
  const label = `Round ${round.roundNumber}`;
  if (days <= 0) {
    const where =
      today > graceEndFor(round.endDate) ? "its grace week is already over" : today > round.endDate ? "it's already in its grace week" : "";
    return { error: `${label} is already past that point${where ? `: ${where}` : ""}.` };
  }
  const message =
    action === "deadline_passed"
      ? `${label}'s deadline was yesterday. Its grace week starts today.`
      : action === "in_grace"
        ? `${label} is midway through its grace week.`
        : `${label}'s grace week ended yesterday. Its matches can't be scored now.`;
  return { days, message };
}

/** A YYYY-MM-DD date moved `days` earlier. */
export function earlier(date: string, days: number): string {
  return addDays(date, -days);
}

/** An ISO timestamp moved `days` earlier, or null. */
export function earlierTime(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t - days * 86_400_000).toISOString();
}
