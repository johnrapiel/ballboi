import { clockTime } from "./timeFormat";

// Past-due matches (Wave 2 finding 47, John, Nov 12): an hour after a
// match's set start with no score, Home's card reads "Earlier today · 6:30 PM",
// Enter score leads and Record with Ball Boi becomes a text link (in case
// they're still playing). From the next day the existing late-match and
// "Did it happen?" flows take over, so this only applies on the match's own
// day. One helper for Home, the league page and Match detail. Pure, so it's
// tested in lib/__tests__.

/** How long after the set start a match without a score counts as past due. */
export const PAST_DUE_AFTER_MS = 60 * 60 * 1000;

/**
 * The league's time zone when it's a real one, else undefined (the phone's
 * own zone). The API's leagueZone falls back to New York for a league with
 * none; a Discover match has no league, so the phone's zone is the right day.
 */
export function matchZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return undefined;
  }
}

/** "2026-11-12" for a moment, in a time zone (or the phone's). */
function dayIn(at: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export interface TimedMatch {
  /** The set start time; past due needs one. */
  scheduledAt?: string | null;
  /** A score on the match means it isn't past due. */
  score?: string | null;
  played?: boolean;
  /** The league's zone (`leagueZone`); null or missing uses the phone's. */
  timeZone?: string | null;
}

/**
 * True when the match's set start is more than an hour ago, it has no score,
 * and it's still the match's day in the league's time zone. The next day it's
 * false: the late-match and "Did it happen?" flows handle it then.
 */
export function isPastDue(m: TimedMatch, now: Date = new Date()): boolean {
  if (!m.scheduledAt || m.score || m.played) return false;
  const at = new Date(m.scheduledAt);
  if (Number.isNaN(at.getTime())) return false;
  if (now.getTime() - at.getTime() <= PAST_DUE_AFTER_MS) return false;
  const zone = matchZone(m.timeZone);
  return dayIn(at, zone) === dayIn(now, zone);
}

/** "Earlier today · 6:30 PM" (decision 180 time format). */
export function pastDueWhen(scheduledAt: string): string {
  return `Earlier today · ${clockTime(new Date(scheduledAt))}`;
}

/** "Earlier today, 6:30 PM", as VoiceOver reads it. */
export function pastDueSpoken(scheduledAt: string): string {
  return `Earlier today, ${clockTime(new Date(scheduledAt))}`;
}

/**
 * Which match leads Home: a match still ahead today (or within its first
 * hour) leads over a past-due one. A past-due match stays the hero when
 * nothing else is on today. Returns the index of the hero, or -1 when the
 * list is empty or `canLead` rules every match out.
 */
export function heroIndex<T extends TimedMatch>(items: T[], now: Date = new Date(), canLead: (m: T) => boolean = () => true): number {
  const first = items.findIndex(canLead);
  if (first < 0 || !isPastDue(items[first], now)) return first;
  const zone = (m: T) => matchZone(m.timeZone);
  const aheadToday = items.findIndex(
    (m, n) =>
      n > first &&
      canLead(m) &&
      !!m.scheduledAt &&
      !isPastDue(m, now) &&
      dayIn(new Date(m.scheduledAt), zone(m)) === dayIn(now, zone(m)),
  );
  return aheadToday >= 0 ? aheadToday : first;
}

export interface CardLead {
  /** Earlier today, no score: Enter score leads. */
  pastDue: boolean;
  /** Record with Ball Boi: the primary button, a text link once past due, or not offered. */
  record: "button" | "link" | null;
}

/**
 * How Record with Ball Boi shows on a match card. `canRecord` is whether the
 * card would offer Record at all (singles, playable, its day); doubles never
 * records yet, so it has no link either.
 */
export function cardLead(m: TimedMatch, opts: { canRecord: boolean; now?: Date }): CardLead {
  const pastDue = isPastDue(m, opts.now);
  return { pastDue, record: opts.canRecord ? (pastDue ? "link" : "button") : null };
}

/** True when the match's set start falls on today, in its league's zone (or the phone's). */
export function isMatchToday(m: Pick<TimedMatch, "scheduledAt" | "timeZone">, now: Date = new Date()): boolean {
  if (!m.scheduledAt) return false;
  const at = new Date(m.scheduledAt);
  if (Number.isNaN(at.getTime())) return false;
  const zone = matchZone(m.timeZone);
  return dayIn(at, zone) === dayIn(now, zone);
}

/**
 * Which matches may lead Home with the match card (Wave 2 finding 63, John,
 * Nov 14): every match, and an open match on its day. An open match on
 * another day stays a row, so it never takes the card from a league or
 * Discover match. Pass it to heroIndex, whose order rules still apply.
 */
export function canLeadHome(m: TimedMatch & { kind: string }, now: Date = new Date()): boolean {
  return m.kind !== "open" || isMatchToday(m, now);
}

/** A match on the Ball Boi tab: a set time, or a league round's play-by day (YYYY-MM-DD, league zone). */
export interface RecordTabMatch extends TimedMatch {
  playBy?: string | null;
}

/**
 * Match day on the Ball Boi tab (Wave 2 finding 64, John, Nov 14): a set
 * time today, past due included (decision 197), or, with no time set, the
 * last day to play it. Only then does it get the full card with Record with
 * Ball Boi; every other match this week is a row under "Coming up".
 */
export function isRecordDay(m: RecordTabMatch, now: Date = new Date()): boolean {
  if (m.scheduledAt && !Number.isNaN(new Date(m.scheduledAt).getTime())) return isMatchToday(m, now);
  return !!m.playBy && m.playBy === dayIn(now, matchZone(m.timeZone));
}

/** The Ball Boi tab's two lists, each in the order given: full cards today, rows under "Coming up". */
export function splitRecordDay<T extends RecordTabMatch>(matches: T[], now: Date = new Date()): { today: T[]; later: T[] } {
  const today: T[] = [];
  const later: T[] = [];
  for (const m of matches) (isRecordDay(m, now) ? today : later).push(m);
  return { today, later };
}
