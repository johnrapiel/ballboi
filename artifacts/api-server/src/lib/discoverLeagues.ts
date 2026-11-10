// Open leagues near you (spec: Discover, "Open leagues: distance, level range,
// format, start date, spots left"; "Joining an Open league"; brief items 17
// to 22). Pure rules; discoverRepo.ts fetches the rows.
//
// An Open league shows where its organizer plays: the center of their home
// ZIP, never an address. Leagues you're already in, ended leagues, and
// leagues run by someone blocked either way don't show.

import { RADIUS_STEPS, distanceLabel, milesBetween, type Point } from "./discoverArea.js";
import { hasSeasonStarted, shortDate } from "./leagueCalendar.js";

export interface OpenLeagueCandidate {
  leagueId: number;
  name: string;
  format: string;
  leagueType: string;
  /** Doubles: fixed | rotating (D1). */
  partnerMode?: string | null;
  location: string | null;
  startDate: string | null;
  seasonWeeks: number | null;
  minRating: string | null;
  maxRating: string | null;
  rosterCap: number | null;
  organizerName: string;
  point: Point;
  /** The league's own today, in its time zone. */
  today: string;
  activePlayers: number;
  /** Your latest request: pending, or declined and not dismissed. */
  myRequest: { kind: "request" | "waitlist"; status: "pending" | "declined" } | null;
}

export type LeagueTag = "outside_level" | "full" | "started";

export interface OpenLeagueCard {
  leagueId: number;
  name: string;
  /** "~6 mi · Flex · Singles · Level 3.0 to 4.0" */
  detail: string;
  /** "Starts Sun, Nov 22 · 3 spots left", "Full · Waitlist for next season" */
  status: string;
  tags: LeagueTag[];
  /** request: the organizer approves now. waitlist: started or full, so requests wait for next season. */
  joining: "request" | "waitlist";
  myRequest: OpenLeagueCandidate["myRequest"];
  spoken: string;
  /** D8: a doubles league, for the Doubles pill. */
  doubles: boolean;
}

export const formatLabel = (f: string) => (f === "flex" ? "Flex" : "Round robin");
export const typeLabel = (t: string) => (t === "doubles" ? "Doubles" : "Singles");
/** D1: "Fixed partners" or "Rotating partners" for a doubles league; null for singles. */
export const partnersLabel = (t: string, mode: string | null | undefined) =>
  t === "doubles" ? (mode === "fixed" ? "Fixed partners" : "Rotating partners") : null;
/** D8: Discover's Format filter. */
export type PlayFilter = "singles" | "doubles";
export function parsePlay(v: unknown): PlayFilter | null {
  return v === "singles" || v === "doubles" ? v : null;
}

/** "Level 3.0 to 4.0", "Level 3.5 and up", "Level up to 4.0" or "All levels". */
export function levelText(l: Pick<OpenLeagueCandidate, "minRating" | "maxRating">): string {
  if (l.minRating && l.maxRating) return `Level ${l.minRating} to ${l.maxRating}`;
  if (l.minRating) return `Level ${l.minRating} and up`;
  if (l.maxRating) return `Level up to ${l.maxRating}`;
  return "All levels";
}

/** Outside your level: you can still ask, and the organizer decides (brief item 20). */
export function outsideLevel(l: Pick<OpenLeagueCandidate, "minRating" | "maxRating">, mine: number | null): boolean {
  if (mine == null) return false;
  const min = l.minRating ? Number(l.minRating) : null;
  const max = l.maxRating ? Number(l.maxRating) : null;
  return (min != null && mine < min - 1e-9) || (max != null && mine > max + 1e-9);
}

export function spotsLeft(l: Pick<OpenLeagueCandidate, "rosterCap" | "activePlayers">): number | null {
  return l.rosterCap ? Math.max(0, l.rosterCap - l.activePlayers) : null;
}

export function leagueState(l: OpenLeagueCandidate) {
  const left = spotsLeft(l);
  const started = hasSeasonStarted(l.startDate, l.today);
  const full = left === 0;
  return { left, started, full, joining: started || full ? ("waitlist" as const) : ("request" as const) };
}

export function leagueCard(viewer: Point, myRating: number | null, l: OpenLeagueCandidate): OpenLeagueCard & { miles: number } {
  const miles = milesBetween(viewer, l.point);
  const { left, started, full, joining } = leagueState(l);
  const tags: LeagueTag[] = [];
  if (outsideLevel(l, myRating)) tags.push("outside_level");
  if (full) tags.push("full");
  else if (started) tags.push("started");
  const detail = [distanceLabel(miles), formatLabel(l.format), typeLabel(l.leagueType), levelText(l)].join(" · ");
  const status = full
    ? "Full · Waitlist for next season"
    : started
      ? `Started ${l.startDate ? shortDate(l.startDate) : ""} · Waitlist for next season`.replace("Started  ·", "Started ·")
      : [l.startDate ? `Starts ${shortDate(l.startDate)}` : "Start date not set", left != null ? `${left} ${left === 1 ? "spot" : "spots"} left` : null]
          .filter(Boolean)
          .join(" · ");
  const tagWords = tags.map((t) => (t === "outside_level" ? "outside your level" : t === "full" ? "full" : "season started"));
  const m = Math.max(1, Math.round(miles));
  return {
    leagueId: l.leagueId,
    name: l.name,
    detail,
    status,
    tags,
    joining,
    myRequest: l.myRequest,
    miles,
    doubles: l.leagueType === "doubles",
    spoken: [
      l.name,
      ...tagWords,
      `about ${m} mile${m === 1 ? "" : "s"} away`,
      [formatLabel(l.format), typeLabel(l.leagueType).toLowerCase(), partnersLabel(l.leagueType, l.partnerMode)?.toLowerCase()].filter(Boolean).join(", "),
      levelText(l).toLowerCase(),
      status.replace(/ · /g, ", "),
      l.myRequest?.status === "pending" ? (l.myRequest.kind === "waitlist" ? "you're on the waitlist" : "request sent") : null,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

/** Leagues within `radius`, nearest first, then soonest start, with a count per distance chip. */
export function nearbyLeagues(viewer: Point, myRating: number | null, candidates: OpenLeagueCandidate[], radius: number, play: PlayFilter | null = null) {
  // D8: the Format filter narrows the list and every distance count.
  const shown = play ? candidates.filter((l) => (play === "doubles") === (l.leagueType === "doubles")) : candidates;
  const cards = shown.map((l) => leagueCard(viewer, myRating, l));
  const steps = [...new Set<number>([...RADIUS_STEPS, radius])].sort((a, b) => a - b);
  const counts = steps.map((r) => ({ radius: r, count: cards.filter((c) => c.miles <= r).length }));
  const leagues = cards
    .filter((c) => c.miles <= radius)
    .sort((a, b) => Math.round(a.miles) - Math.round(b.miles) || a.leagueId - b.leagueId)
    .map(({ miles: _m, ...card }) => card);
  return { leagues, counts };
}
