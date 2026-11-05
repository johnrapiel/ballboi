// Open leagues near you (spec: Discover, "Open leagues: distance, level range,
// format, start date, spots left"; "Joining an Open league"). Pure rules;
// discoverRepo.ts fetches the rows.

import { distanceLabel, milesBetween, type Point } from "./discoverArea.js";
import { hasSeasonStarted } from "./leagueCalendar.js";
import { ratingRangeLabel } from "./leagueJoining.js";

export interface OpenLeagueCandidate {
  leagueId: number;
  name: string;
  format: string;
  startDate: string | null;
  endDate: string | null;
  minRating: string | null;
  maxRating: string | null;
  rosterCap: number | null;
  point: Point;
  /** The league's own today, on its time zone. */
  today: string;
  activePlayers: number;
  /** The viewer's pending request or waitlist spot. */
  myRequest: "request" | "waitlist" | null;
}

export interface OpenLeagueCard {
  leagueId: number;
  name: string;
  format: "flex" | "round_robin";
  /** "3.0 to 4.0", "3.5 and up", "up to 4.0" or "All levels". */
  levelRange: string;
  startDate: string | null;
  distanceLabel: string;
  /** Null when the league has no roster cap. */
  spotsLeft: number | null;
  /** join: requests go to the admin now. waitlist: started or full, so requests wait for next season. */
  joining: "join" | "waitlist";
  myRequest: "request" | "waitlist" | null;
}

export function levelRangeText(l: Pick<OpenLeagueCandidate, "minRating" | "maxRating">): string {
  const r = ratingRangeLabel(l);
  return r === "all" ? "All levels" : r.charAt(0).toUpperCase() + r.slice(1);
}

export function openLeagueCard(viewer: Point, l: OpenLeagueCandidate): OpenLeagueCard & { miles: number } {
  const miles = milesBetween(viewer, l.point);
  const spotsLeft = l.rosterCap ? Math.max(0, l.rosterCap - l.activePlayers) : null;
  const started = hasSeasonStarted(l.startDate, l.today);
  return {
    leagueId: l.leagueId,
    name: l.name,
    format: l.format === "flex" ? "flex" : "round_robin",
    levelRange: levelRangeText(l),
    startDate: l.startDate,
    distanceLabel: distanceLabel(miles),
    spotsLeft,
    joining: started || spotsLeft === 0 ? "waitlist" : "join",
    myRequest: l.myRequest,
    miles,
  };
}

/** Open leagues within `radius` miles: ones taking requests first, then nearest, then soonest start. */
export function nearbyLeagues(viewer: Point, candidates: OpenLeagueCandidate[], radius: number): OpenLeagueCard[] {
  return candidates
    .map((l) => openLeagueCard(viewer, l))
    .filter((c) => c.miles <= radius)
    .sort(
      (a, b) =>
        Number(a.joining === "waitlist") - Number(b.joining === "waitlist") ||
        Math.round(a.miles) - Math.round(b.miles) ||
        (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") ||
        a.leagueId - b.leagueId,
    )
    .map(({ miles: _miles, ...card }) => card);
}
