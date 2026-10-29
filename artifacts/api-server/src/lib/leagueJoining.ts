// Joining and leaving a league (spec: Leagues > Joining and leaving; Discover >
// Joining an Open league). Pure rules, so they're easy to test.
//
// - Every league locks to new joins once its season starts, Private and Open
//   alike. The waitlist holds requests for next season (decision 26).
// - Open leagues take requests before the season starts; an admin approves.
//   They can set a rating range and a roster cap. Full leagues waitlist too.
// - Private leagues are joined with an invite link or code.

import { hasSeasonStarted, shortDate } from "./leagueCalendar.js";

export interface JoinableLeague {
  startDate: string | null;
  visibility: string;
  rosterCap: number | null;
  minRating: string | null;
  maxRating: string | null;
}

export type JoinOutcome =
  | { kind: "join" }
  | { kind: "request" }
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
  if (hasSeasonStarted(league.startDate, input.today)) {
    return {
      kind: "waitlist",
      reason: `The season started on ${shortDate(league.startDate!)}, so you're on the waitlist for next season.`,
    };
  }
  if (league.rosterCap && input.activePlayerCount >= league.rosterCap) {
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

/** Whether an admin can approve a pending request now. Once the season starts, it moves to the waitlist. */
export function approveOutcome(input: {
  league: JoinableLeague;
  activePlayerCount: number;
  today: string;
  request: { kind: string; status: string };
}): { ok: true } | { ok: false; moveToWaitlist: boolean; status: number; error: string } {
  if (input.request.status !== "pending") {
    return { ok: false, moveToWaitlist: false, status: 409, error: "This request was already handled." };
  }
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
