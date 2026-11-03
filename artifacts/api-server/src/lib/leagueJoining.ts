// Joining and leaving a league (spec: Leagues > Joining and leaving; Discover >
// Joining an Open league). Pure rules, so they're easy to test.
//
// - Every league locks to direct joins once its season starts (decision 26).
// - Waitlists are for Open leagues only (decision 30). An Open league that
//   has started, or is full, holds requests on a waitlist for next season.
// - A Private league's code entered after its season starts (or once it's
//   full) creates a join request; the admin approves or declines it, and an
//   approved player enters the next round at zero wins (decision 30).
// - Open leagues take requests before the season starts; an admin approves.
//   They can set a rating range and a roster cap.
// - Private leagues are joined with an invite link or code.

import { hasSeasonStarted, shortDate } from "./leagueCalendar.js";

export interface JoinableLeague {
  startDate: string | null;
  visibility: string;
  rosterCap: number | null;
  minRating: string | null;
  maxRating: string | null;
}

/** What the player sees after asking to join a Private league that's already started (decision 30). */
export const PRIVATE_REQUEST_MESSAGE =
  "This season's already started, but we've let the organizer know you'd like to join. You'll hear back here.";
export const PRIVATE_FULL_MESSAGE =
  "This league is full, but we've let the organizer know you'd like to join. You'll hear back here.";

export type JoinOutcome =
  | { kind: "join" }
  | { kind: "request"; reason?: string }
  | { kind: "waitlist"; reason: string }
  | { kind: "refuse"; status: number; error: string };

/** What happens when someone asks to join, by invite or by request from Discover. */
export function joinOutcome(input: {
  league: JoinableLeague;
  activePlayerCount: number;
  today: string;
  via: "invite" | "request";
  skillLevel?: string | null;
}): JoinOutcome {
  const { league, via } = input;
  if (via === "request" && league.visibility !== "open") {
    return { kind: "refuse", status: 403, error: "This league is invite-only. Ask its admin for an invite link." };
  }
  if (via === "request" && input.skillLevel) {
    const rating = Number(input.skillLevel);
    const min = league.minRating ? Number(league.minRating) : null;
    const max = league.maxRating ? Number(league.maxRating) : null;
    if ((min !== null && rating < min) || (max !== null && rating > max)) {
      return { kind: "refuse", status: 400, error: `This league is for ${ratingRangeLabel(league)} players.` };
    }
  }
  const started = hasSeasonStarted(league.startDate, input.today);
  const full = !!league.rosterCap && input.activePlayerCount >= league.rosterCap;
  // Private leagues never waitlist: the organizer decides (decision 30).
  if (league.visibility !== "open" && (started || full)) {
    return { kind: "request", reason: started ? PRIVATE_REQUEST_MESSAGE : PRIVATE_FULL_MESSAGE };
  }
  if (started) {
    return {
      kind: "waitlist",
      reason: `The season started on ${shortDate(league.startDate!)}, so you're on the waitlist for next season.`,
    };
  }
  if (full) {
    return { kind: "waitlist", reason: "This league is full, so you're on the waitlist for next season." };
  }
  return via === "invite" ? { kind: "join" } : { kind: "request" };
}

export function ratingRangeLabel(league: Pick<JoinableLeague, "minRating" | "maxRating">): string {
  if (league.minRating && league.maxRating) return `${league.minRating} to ${league.maxRating}`;
  if (league.minRating) return `${league.minRating} and up`;
  if (league.maxRating) return `up to ${league.maxRating}`;
  return "all";
}

/**
 * Whether an admin can approve a pending request now. Private leagues: any
 * time, even mid-season; the player enters the next round at zero wins
 * (decision 30). Open leagues: only before the season starts and while
 * there's room; otherwise the request moves to the waitlist.
 */
export function approveOutcome(input: {
  league: JoinableLeague;
  activePlayerCount: number;
  today: string;
  request: { kind: string; status: string };
}): { ok: true } | { ok: false; moveToWaitlist: boolean; status: number; error: string } {
  if (input.request.status !== "pending") {
    return { ok: false, moveToWaitlist: false, status: 409, error: "This request was already handled." };
  }
  if (input.league.visibility !== "open") return { ok: true };
  if (input.request.kind === "waitlist" || hasSeasonStarted(input.league.startDate, input.today)) {
    return {
      ok: false,
      moveToWaitlist: input.request.kind !== "waitlist",
      status: 409,
      error: "The season has started, so this player is on the waitlist for next season.",
    };
  }
  if (input.league.rosterCap && input.activePlayerCount >= input.league.rosterCap) {
    return { ok: false, moveToWaitlist: true, status: 409, error: "The league is full, so this player is on the waitlist for next season." };
  }
  return { ok: true };
}

/**
 * The week a late joiner came in, for "You joined in week 3 of 8" (C3).
 * Null when they joined before the season started.
 */
export function joinedWeek(seasonStart: string | null, joinedOn: string, seasonWeeks: number | null): number | null {
  if (!seasonStart || !seasonWeeks || joinedOn < seasonStart) return null;
  const days = Math.round((Date.parse(`${joinedOn}T00:00:00Z`) - Date.parse(`${seasonStart}T00:00:00Z`)) / 86_400_000);
  return Math.min(seasonWeeks, Math.floor(days / 7) + 1);
}

export interface LeavableMatch {
  id: number;
  status: string;
  voidedAt: Date | null;
}

/**
 * A player who drops out keeps their played matches; their remaining matches
 * are voided (decision 27). Returns the ids to void.
 */
export function matchesToVoid(matches: LeavableMatch[]): number[] {
  return matches.filter((m) => m.status !== "completed" && !m.voidedAt).map((m) => m.id);
}
