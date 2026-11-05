// Match requests (spec: Discover, "From found to playing"). Pure rules: what a
// request is, where it stands for each player, and what each answer changes.
// The routes in routes/matchRequests.ts fetch, save and send the pushes.

import { MATCH_REQUEST_KINDS, type MatchRequestKind, type MatchRequestStatus } from "@workspace/db";

import { addDays, isTimeZone, localDate, zonedTime } from "./leagueCalendar.js";

/** How far ahead a request can be. */
export const MAX_DAYS_AHEAD = 60;
/** Longest time window. */
export const MAX_WINDOW_HOURS = 6;
/** Counters per request, so a back-and-forth ends in a message instead. */
export const MAX_COUNTERS = 3;
/** New requests one player can send in a day. */
export const DAILY_REQUEST_LIMIT = 10;
/** How long after the start a player can say the other didn't show. */
export const NO_SHOW_HOURS = 48;
/** When the day-before confirm prompt goes out, in the request's time zone. */
export const CONFIRM_PROMPT_TIME = "08:00";
/** The reminder before the window starts. */
export const REMINDER_HOURS = 2;

export interface When {
  date: string;
  windowStart: string;
  windowEnd: string;
}

export interface NewMatchRequest extends When {
  toUserId: number;
  timeZone: string;
  courtId: number | null;
  kind: MatchRequestKind;
  note: string | null;
}

/** The fields the rules read. A database row has all of them. */
export interface RequestState extends When {
  fromClerkUserId: string;
  toClerkUserId: string;
  timeZone: string;
  status: MatchRequestStatus;
  waitingOnClerkUserId: string;
  counters: number;
  matchId: number | null;
  fromConfirmedAt: Date | null;
  toConfirmedAt: Date | null;
  noShowClerkUserId: string | null;
}

export type Phase =
  | "waiting_on_you"
  | "waiting_on_them"
  | "upcoming"
  | "to_confirm"
  | "started"
  | "declined"
  | "withdrawn"
  | "cancelled"
  | "expired";

export type Action = "accept" | "counter" | "decline" | "withdraw" | "confirm" | "cancel" | "no_show";

const HALF_HOUR = /^([01]\d|2[0-3]):(00|30)$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** A date and time window, checked. The window is on the half hour, in the future, and up to 6 hours. */
export function parseWhen(body: Record<string, unknown>, timeZone: string, now: Date): When | { error: string } {
  const { date, windowStart, windowEnd } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { error: "Pick a day." };
  }
  if (typeof windowStart !== "string" || typeof windowEnd !== "string" || !HALF_HOUR.test(windowStart) || !HALF_HOUR.test(windowEnd)) {
    return { error: "Pick a start and end time on the hour or half hour." };
  }
  const length = minutes(windowEnd) - minutes(windowStart);
  if (length <= 0) return { error: "The end time has to be after the start time." };
  if (length > MAX_WINDOW_HOURS * 60) return { error: `Keep the time window to ${MAX_WINDOW_HOURS} hours.` };
  if (zonedTime(date, windowStart, timeZone).getTime() <= now.getTime()) return { error: "Pick a time that hasn't started yet." };
  if (date > addDays(localDate(now, timeZone), MAX_DAYS_AHEAD)) return { error: `Pick a day in the next ${MAX_DAYS_AHEAD} days.` };
  return { date, windowStart, windowEnd };
}

/** A new request, checked. The note goes through the same filter as first messages. */
export function parseMatchRequest(body: unknown, textOk: (t: string) => boolean, now: Date): NewMatchRequest | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(b.toUserId)) return { error: "Pick a player." };
  if (!isTimeZone(b.timeZone)) return { error: "Your phone's time zone didn't come through. Try again." };
  const when = parseWhen(b, b.timeZone, now);
  if ("error" in when) return when;
  const courtId = b.courtId ?? null;
  if (courtId !== null && !Number.isInteger(courtId)) return { error: "Pick a court from the list." };
  const kind = b.kind ?? "singles";
  if (typeof kind !== "string" || !(MATCH_REQUEST_KINDS as readonly string[]).includes(kind)) return { error: "Pick singles or a practice hit." };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().replace(/\s+/g, " ") : null;
  if (note && note.length > 200) return { error: "Keep the note to 200 characters." };
  if (note && !textOk(note)) return { error: "Notes can't include links, phone numbers or slurs. Send those in a message once you're talking." };
  return { ...when, toUserId: b.toUserId as number, timeZone: b.timeZone, courtId: courtId as number | null, kind: kind as MatchRequestKind, note };
}

export const startOf = (r: Pick<RequestState, "date" | "windowStart" | "timeZone">) => zonedTime(r.date, r.windowStart, r.timeZone);

const confirmedBy = (r: RequestState, viewer: string) =>
  viewer === r.fromClerkUserId ? r.fromConfirmedAt != null : r.toConfirmedAt != null;

/** Where a request stands for one of its two players. */
export function phaseFor(r: RequestState, viewer: string, now: Date): Phase {
  const started = now.getTime() >= startOf(r).getTime();
  switch (r.status) {
    case "pending":
      if (started) return "expired";
      return r.waitingOnClerkUserId === viewer ? "waiting_on_you" : "waiting_on_them";
    case "accepted": {
      if (started) return "started";
      const dayBefore = addDays(r.date, -1);
      return localDate(now, r.timeZone) >= dayBefore && !confirmedBy(r, viewer) ? "to_confirm" : "upcoming";
    }
    default:
      return r.status;
  }
}

/** What a player can do with a request now. Score entry goes through the match itself. */
export function actionsFor(r: RequestState, viewer: string, now: Date): Action[] {
  const phase = phaseFor(r, viewer, now);
  switch (phase) {
    case "waiting_on_you":
      return r.counters < MAX_COUNTERS ? ["accept", "counter", "decline"] : ["accept", "decline"];
    case "waiting_on_them":
      return ["withdraw"];
    case "to_confirm":
      return ["confirm", "cancel"];
    case "upcoming":
      return ["cancel"];
    case "started": {
      const late = now.getTime() - startOf(r).getTime() > NO_SHOW_HOURS * 3600_000;
      return r.noShowClerkUserId || late ? [] : ["no_show"];
    }
    default:
      return [];
  }
}

export const otherPlayer = (r: Pick<RequestState, "fromClerkUserId" | "toClerkUserId">, viewer: string) =>
  viewer === r.fromClerkUserId ? r.toClerkUserId : r.fromClerkUserId;

/** "9 AM", "9:30 AM", "12 PM". */
function clock(t: string, withMeridiem = true): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time = m === "00" ? `${h12}` : `${h12}:${m}`;
  return withMeridiem ? `${time} ${h < 12 ? "AM" : "PM"}` : time;
}

/** "Sat, Nov 8, 9 to 11 AM" or "Sat, Nov 8, 11 AM to 1 PM", in the request's own time zone. */
export function whenLabel(w: When): string {
  const day = new Date(`${w.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const sameHalf = Number(w.windowStart.slice(0, 2)) < 12 === Number(w.windowEnd.slice(0, 2)) < 12;
  const range = sameHalf ? `${clock(w.windowStart, false)} to ${clock(w.windowEnd)}` : `${clock(w.windowStart)} to ${clock(w.windowEnd)}`;
  return `${day}, ${range}`;
}

export const KIND_LABEL: Record<MatchRequestKind, string> = { singles: "Singles", practice: "Practice hit" };

/**
 * Which requests are due a push: the day-before confirm prompt from 8 AM the
 * day before, and the reminder 2 hours before the window. Only accepted
 * requests that haven't started, and only once each (the route claims them).
 */
export function dueReminders(
  rows: (RequestState & { id: number; confirmPromptSentAt: Date | null; reminderSentAt: Date | null })[],
  now: Date,
): { confirm: number[]; remind: number[] } {
  const confirm: number[] = [];
  const remind: number[] = [];
  for (const r of rows) {
    if (r.status !== "accepted") continue;
    const start = startOf(r).getTime();
    if (now.getTime() >= start) continue;
    if (!r.confirmPromptSentAt && now.getTime() >= zonedTime(addDays(r.date, -1), CONFIRM_PROMPT_TIME, r.timeZone).getTime()) {
      confirm.push(r.id);
    }
    if (!r.reminderSentAt && now.getTime() >= start - REMINDER_HOURS * 3600_000) remind.push(r.id);
  }
  return { confirm, remind };
}
