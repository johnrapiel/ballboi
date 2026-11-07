// Setting up a match in chat (F2, F12, F13; brief items 27 to 37). Pure
// rules, so every step is testable: what each player sees in the chat, which
// answers they have, and how no-shows count.
//
// The flow:
// 1. A sends a card: day, time, court (or not set), Singles or Practice hit.
//    B sees "Add this match?" with "I'm in" and "Can't make it". A newer card
//    from either player replaces the older one; only the latest can be added.
// 2. "I'm in": both see "Match added"; it's a real match on both schedules.
//    Either player can Undo for 10 minutes.
// 3. The day before: "Still on for tomorrow at 6 PM?" with "I'm in" and
//    "Can't make it". No answer means still on. A reminder 2 hours before.
// 4. "Can't make it" (confirmed) takes it off both schedules and tells the
//    other player. Canceling before the match never counts as a no-show.
// 5. 3 hours after the start with no score: "Did it happen?" with Enter the
//    score, They didn't show, We didn't play.
// 6. "They didn't show": the other player has 48 hours to answer "We played:
//    enter the score", "That's not right" or "I couldn't make it". A dispute
//    goes on neither card (F12); "I couldn't make it" or no answer in 48 hours
//    puts a no-show on their card (F13). A score always wins.

import type { MatchPlan } from "@workspace/db";

export const UNDO_MINUTES = 10;
export const DAY_BEFORE_HOURS = 24;
export const REMINDER_HOURS = 2;
export const DID_IT_HAPPEN_HOURS = 3;
export const NO_SHOW_HOURS = 48;
/** Cards can be sent up to this far ahead. */
export const MAX_DAYS_AHEAD = 60;

const H = 3_600_000;

export const PAST_TIME = "That time has passed. Pick a later time.";

export type PlanKind = "singles" | "practice";

export interface NewPlan {
  startsAt: Date;
  timeZone: string;
  courtId: number | null;
  kind: PlanKind;
}

/** Checks a new card. */
export function parseNewPlan(body: unknown, now: Date): NewPlan | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const startsAt = typeof b.startsAt === "string" ? new Date(b.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return { error: "Pick a day and time." };
  if (startsAt.getTime() <= now.getTime()) return { error: PAST_TIME };
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * H) return { error: `Pick a day in the next ${MAX_DAYS_AHEAD} days.` };
  const timeZone = typeof b.timeZone === "string" && b.timeZone.length <= 64 && isZone(b.timeZone) ? b.timeZone : "America/New_York";
  const courtId = b.courtId == null ? null : Number.isInteger(b.courtId) && (b.courtId as number) > 0 ? (b.courtId as number) : NaN;
  if (Number.isNaN(courtId)) return { error: "Pick a court from the list, or leave it not set." };
  const kind = b.kind === "practice" ? "practice" : b.kind === undefined || b.kind === "singles" ? "singles" : null;
  if (!kind) return { error: "Pick Singles or Practice hit." };
  return { startsAt, timeZone, courtId, kind };
}

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const pairKeyOf = (a: string, b: string) => [a, b].sort().join(":");

type Plan = Pick<
  MatchPlan,
  | "id"
  | "proposerClerkUserId"
  | "recipientClerkUserId"
  | "startsAt"
  | "status"
  | "respondedAt"
  | "endedAt"
  | "endedByClerkUserId"
  | "proposerStillOnAt"
  | "recipientStillOnAt"
  | "noShowReporterClerkUserId"
  | "noShowClerkUserId"
  | "noShowReportedAt"
  | "noShowStatus"
  | "noShowAnsweredAt"
  | "createdAt"
>;

/** The match row's score, when there is one. */
export interface PlanMatch {
  matchId: number | null;
  score: string | null;
}

export const dayBeforeAt = (p: Pick<Plan, "startsAt">) => new Date(p.startsAt.getTime() - DAY_BEFORE_HOURS * H);
export const reminderAt = (p: Pick<Plan, "startsAt">) => new Date(p.startsAt.getTime() - REMINDER_HOURS * H);
export const didItHappenAt = (p: Pick<Plan, "startsAt">) => new Date(p.startsAt.getTime() + DID_IT_HAPPEN_HOURS * H);
export const noShowDeadline = (p: Pick<Plan, "noShowReportedAt">) =>
  p.noShowReportedAt ? new Date(p.noShowReportedAt.getTime() + NO_SHOW_HOURS * H) : null;

/** The no-show as it stands now: unanswered after 48 hours counts as confirmed (F13). A score always wins. */
export function noShowState(p: Plan, m: PlanMatch, now: Date): "none" | "pending" | "confirmed" | "disputed" {
  if (!p.noShowStatus || m.score) return "none";
  if (p.noShowStatus === "pending") return now >= noShowDeadline(p)! ? "confirmed" : "pending";
  return p.noShowStatus;
}

/** Discover no-shows per account: confirmed or unanswered for 48 hours, never disputed (F12, F13). */
export function noShowCounts(plans: { plan: Plan; match: PlanMatch }[], now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const { plan, match } of plans) {
    if (!plan.noShowClerkUserId || noShowState(plan, match, now) !== "confirmed") continue;
    out.set(plan.noShowClerkUserId, (out.get(plan.noShowClerkUserId) ?? 0) + 1);
  }
  return out;
}

export type PlanAction =
  | "accept"
  | "decline"
  | "undo"
  | "still_on"
  | "cancel"
  | "score"
  | "no_show"
  | "not_played"
  | "dispute"
  | "admit";

export type PlanEventType =
  | "proposed"
  | "added"
  | "undone"
  | "declined"
  | "day_before"
  | "canceled"
  | "did_it_happen"
  | "not_played"
  | "no_show_reported"
  | "no_show_disputed"
  | "no_show_confirmed"
  | "scored";

export interface PlanEvent {
  key: string;
  type: PlanEventType;
  at: string;
  /** Who did it, when someone did: "me" or "them". */
  by: "me" | "them" | null;
  actions: PlanAction[];
  /** proposed: waiting, replaced, declined, added, undone. */
  state?: string;
  /** day_before: who's said they're still on. */
  meIn?: boolean;
  themIn?: boolean;
  /** no_show_reported: who was reported, and the deadline to answer. */
  about?: "me" | "them";
  deadline?: string;
}

/** Everything in the chat for one card, in order, with the buttons this viewer gets. */
export function planEvents(p: Plan, m: PlanMatch, viewer: string, now: Date): PlanEvent[] {
  const who = (id: string | null): "me" | "them" | null => (id == null ? null : id === viewer ? "me" : "them");
  const mine = p.proposerClerkUserId === viewer ? "proposer" : "recipient";
  const iso = (d: Date) => d.toISOString();
  const out: PlanEvent[] = [];
  const started = now >= p.startsAt;

  const cardState =
    p.status === "proposed" ? "waiting" : p.status === "replaced" ? "replaced" : p.status === "declined" ? "declined" : p.status === "undone" ? "undone" : "added";
  out.push({
    key: `${p.id}:proposed`,
    type: "proposed",
    at: iso(p.createdAt),
    by: who(p.proposerClerkUserId),
    state: cardState,
    actions: p.status === "proposed" && mine === "recipient" && !started ? ["accept", "decline"] : [],
  });
  if (p.status === "declined" && p.respondedAt) out.push({ key: `${p.id}:declined`, type: "declined", at: iso(p.respondedAt), by: who(p.recipientClerkUserId), actions: [] });
  if (!p.respondedAt || !["accepted", "undone", "canceled", "not_played"].includes(p.status)) return out;

  const acceptedAt = p.respondedAt;
  const undoOpen = p.status === "accepted" && now.getTime() - acceptedAt.getTime() < UNDO_MINUTES * 60_000 && !started;
  const beforeDayBefore = p.status === "accepted" && !started && now < dayBeforeAt(p);
  out.push({
    key: `${p.id}:added`,
    type: "added",
    at: iso(acceptedAt),
    by: who(p.recipientClerkUserId),
    actions: undoOpen ? ["undo"] : beforeDayBefore ? ["cancel"] : [],
  });
  if (p.status === "undone") {
    out.push({ key: `${p.id}:undone`, type: "undone", at: iso(p.endedAt ?? acceptedAt), by: who(p.endedByClerkUserId), actions: [] });
    return out;
  }

  const dayBefore = dayBeforeAt(p);
  // A match added less than a day ahead skips straight to the reminder.
  if (now >= dayBefore && dayBefore > acceptedAt && (p.status !== "canceled" || (p.endedAt && p.endedAt >= dayBefore))) {
    const meIn = !!(mine === "proposer" ? p.proposerStillOnAt : p.recipientStillOnAt);
    const themIn = !!(mine === "proposer" ? p.recipientStillOnAt : p.proposerStillOnAt);
    out.push({
      key: `${p.id}:day_before`,
      type: "day_before",
      at: iso(dayBefore),
      by: null,
      meIn,
      themIn,
      actions: p.status === "accepted" && !started ? (meIn ? ["cancel"] : ["still_on", "cancel"]) : [],
    });
  }
  if (p.status === "canceled") {
    out.push({ key: `${p.id}:canceled`, type: "canceled", at: iso(p.endedAt ?? now), by: who(p.endedByClerkUserId), actions: [] });
    return out;
  }

  const ask = didItHappenAt(p);
  if (m.score) {
    // The score is in: that's the answer, whatever else was said.
    if (now >= ask || p.noShowReportedAt) out.push({ key: `${p.id}:scored`, type: "scored", at: iso(now < ask ? p.startsAt : ask), by: null, actions: [] });
    return out;
  }
  if (p.status === "not_played") {
    if (now >= ask) out.push({ key: `${p.id}:did`, type: "did_it_happen", at: iso(ask), by: null, actions: [] });
    out.push({ key: `${p.id}:not_played`, type: "not_played", at: iso(p.endedAt ?? now), by: who(p.endedByClerkUserId), actions: [] });
    return out;
  }
  if (now >= ask || p.noShowReportedAt) {
    out.push({
      key: `${p.id}:did`,
      type: "did_it_happen",
      at: iso(p.noShowReportedAt && p.noShowReportedAt < ask ? p.noShowReportedAt : ask),
      by: null,
      actions: p.noShowReportedAt ? [] : ["score", "no_show", "not_played"],
    });
  }
  if (p.noShowReportedAt && p.noShowClerkUserId) {
    const state = noShowState(p, m, now);
    const about = who(p.noShowClerkUserId)!;
    out.push({
      key: `${p.id}:no_show`,
      type: "no_show_reported",
      at: iso(p.noShowReportedAt),
      by: who(p.noShowReporterClerkUserId),
      about,
      deadline: iso(noShowDeadline(p)!),
      actions: state === "pending" && about === "me" ? ["score", "dispute", "admit"] : [],
    });
    if (state === "disputed")
      out.push({ key: `${p.id}:disputed`, type: "no_show_disputed", at: iso(p.noShowAnsweredAt ?? now), by: about === "me" ? "me" : "them", actions: [] });
    if (state === "confirmed")
      out.push({
        key: `${p.id}:confirmed`,
        type: "no_show_confirmed",
        at: iso(p.noShowAnsweredAt ?? noShowDeadline(p)!),
        by: p.noShowStatus === "confirmed" ? about : null,
        about,
        actions: [],
      });
  }
  return out;
}

export type PlanCommand = "accept" | "decline" | "undo" | "still_on" | "cancel" | "not_played" | "no_show" | "dispute" | "admit";

/** Whether this viewer may do this now, from the same rules the chat draws. Null when allowed. */
export function refusal(cmd: PlanCommand, p: Plan, m: PlanMatch, viewer: string, now: Date, latestProposedId: number | null): string | null {
  if (viewer !== p.proposerClerkUserId && viewer !== p.recipientClerkUserId) return "This match isn't yours.";
  if (cmd === "accept" && p.status === "proposed" && latestProposedId !== p.id) return "A newer card replaced this one.";
  const events = planEvents(p, m, viewer, now);
  const allowed = new Set(events.flatMap((e) => e.actions));
  const action: PlanAction = cmd;
  if (allowed.has(action)) return null;
  if (cmd === "accept" && p.status === "replaced") return "A newer card replaced this one.";
  if (cmd === "undo") return "It's too late to undo. Use Can't make it instead.";
  if (cmd === "dispute" || cmd === "admit") return "The time to answer has passed.";
  return "That isn't possible now.";
}
