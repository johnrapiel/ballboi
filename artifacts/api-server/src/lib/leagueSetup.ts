// Rules for starting a league (spec: Leagues > Setup) that the request schema
// can't express on its own. Pure functions, so they're easy to test.
//
// A season starts tomorrow at the earliest, in the league's time zone (Q7),
// so friends who join on the day it's made are in, not waiting on approval.
// Doubles (D1, D8, John, Nov 9): Fixed or Rotating partners, no playoffs for
// now (decision 79), and room for at least 4 players.

import { addDays, leagueToday } from "./leagueCalendar.js";

export const PICK_PARTNERS = "Pick Fixed partners or Rotating partners for a doubles league.";
export const DOUBLES_NO_PLAYOFFS = "Doubles leagues don't have playoffs yet.";
export const DOUBLES_MIN_ROSTER = "A doubles league needs room for at least 4 players.";
export const START_TOMORROW = "A season can start tomorrow at the earliest.";

export const SKILL_LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"] as const;

export interface LeagueSetupInput {
  format: string;
  leagueType?: string | null;
  partnerMode?: string | null;
  visibility?: string | null;
  minRating?: string | null;
  maxRating?: string | null;
  startDate: string;
  seasonWeeks: number;
  playing?: boolean | null;
  playerName?: string | null;
  playoffSize?: number | null;
  rosterCap?: number | null;
}

/** Returns a plain-English problem with the setup, or null when it's valid. */
export function validateLeagueSetup(input: LeagueSetupInput): string | null {
  if (input.format !== "flex" && input.format !== "round_robin") {
    return "Format must be Flex or Round robin";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || Number.isNaN(Date.parse(`${input.startDate}T00:00:00Z`))) {
    return "Start date must be a date like 2026-11-02";
  }
  if (!Number.isInteger(input.seasonWeeks) || input.seasonWeeks < 1 || input.seasonWeeks > 24) {
    return "A season runs 1 to 24 weeks";
  }
  if (input.leagueType === "doubles") {
    if (input.partnerMode !== "fixed" && input.partnerMode !== "rotating") return PICK_PARTNERS;
    if (input.playoffSize) return DOUBLES_NO_PLAYOFFS;
    if (input.rosterCap != null && input.rosterCap < 4) return DOUBLES_MIN_ROSTER;
  } else if (input.partnerMode) {
    return "Only doubles leagues have partners";
  }
  const levels: readonly string[] = SKILL_LEVELS;
  for (const r of [input.minRating, input.maxRating]) {
    if (r != null && !levels.includes(r)) return "Ratings must be between 2.5 and 5.0";
  }
  if (input.minRating && input.maxRating && Number(input.minRating) > Number(input.maxRating)) {
    return "The lowest rating can't be above the highest";
  }
  if (input.visibility !== "open" && (input.minRating || input.maxRating)) {
    return "Only Open leagues have a rating range";
  }
  if (input.playing !== false && !input.playerName?.trim()) {
    return "Your name is required when you're playing";
  }
  return null;
}

/** Q7: the start date is tomorrow or later on the league's own clock. Returns the problem, or null. */
export function checkStartDate(startDate: string, timeZone: string, now: Date = new Date()): string | null {
  return startDate < addDays(leagueToday(now, timeZone), 1) ? START_TOMORROW : null;
}

/** End date (last day of the final week) and status, from the start date and length. */
export function seasonDates(startDate: string, seasonWeeks: number, today: Date = new Date()) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + seasonWeeks * 7 - 1);
  const todayKey = today.toISOString().slice(0, 10);
  const status = startDate > todayKey ? "upcoming" : "active";
  return { endDate: end.toISOString().slice(0, 10), status } as const;
}
