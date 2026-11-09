// Players near you (spec: Discover; F1, F8, F14). Pure rules, so they're easy
// to test: who shows up, in what order, and how many show at each distance.
//
// - Always local: nobody farther than the distance picked (30 miles at most),
//   measured between home ZIP centers.
// - Approximate distance only: "~4 mi", never a spot.
// - Nearest first (whole miles), then the closest level.
// - Level: "Close to mine" is within 0.5 of yours, "Wider" within 1.0, or Any.
//   Players with no level show only under Any; with no level of your own,
//   every level shows.
// - Plays: Singles or Doubles keep players who play that or both. Players
//   who haven't said show under Either only.
// - "Free when I'm free" keeps players whose hours overlap yours.
// - Hidden profiles, blocks either way, banned or suspended accounts and the
//   viewer never reach these rules: the repository leaves them out.

import { overlaps } from "@workspace/free-times";
import type { FreeRange } from "@workspace/free-times";
import { timesOf } from "./discoverAvailability.js";
import { RADIUS_STEPS, distanceLabel, milesBetween, parseRadius, type Point } from "./discoverArea.js";
import { reliabilityLine, reliabilitySpoken, type Reliability } from "./reliability.js";

export const LEVEL_RANGES = ["close", "wider", "any"] as const;
export type LevelRange = (typeof LEVEL_RANGES)[number];
export const LEVEL_SPAN: Record<Exclude<LevelRange, "any">, number> = { close: 0.5, wider: 1.0 };

export const PLAYS = ["singles", "doubles", "both"] as const;
export type Plays = (typeof PLAYS)[number];
export const PLAYS_FILTERS = ["singles", "doubles", "either"] as const;
export type PlaysFilter = (typeof PLAYS_FILTERS)[number];

/**
 * The Level chips in Filters (John, Nov 7): every level from 2.5 to 5.0
 * (spec decision 86), pick any number, yours selected by default.
 */
export const FILTER_LEVELS = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;

/**
 * Which levels to show: "mine" (the default: just your own level), a list
 * picked in Filters (empty means every level), or null for an older app that
 * still sends the Close / Wider / Any range in `level`.
 */
export type LevelPick = "mine" | number[] | null;

export interface PlayerFilters {
  radius: number;
  level: LevelRange;
  levels: LevelPick;
  plays: PlaysFilter;
  free: boolean;
}

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** Filters from a query string. Anything unknown falls back to the default. */
export function parseFilters(q: Record<string, unknown>, savedRadius: number): PlayerFilters {
  return {
    radius: parseRadius(q.radius, savedRadius),
    level: isOneOf(LEVEL_RANGES, q.level) ? q.level : "close",
    levels: parseLevels(q.levels),
    plays: isOneOf(PLAYS_FILTERS, q.plays) ? q.plays : "either",
    free: q.free === "1" || q.free === "true" || q.free === true,
  };
}

/** `levels=mine`, `levels=3.0,3.5`, `levels=` (every level), or absent (older app). */
export function parseLevels(v: unknown): LevelPick {
  if (typeof v !== "string") return null;
  if (v === "mine") return "mine";
  return [
    ...new Set(
      v
        .split(",")
        .map((x) => Number(x))
        .filter((x) => (FILTER_LEVELS as readonly number[]).includes(x)),
    ),
  ];
}

/** A rating on the chips' scale: the nearest half point, 2.5 to 5.0. */
export function levelChip(rating: number): number {
  return Math.min(5, Math.max(2.5, Math.round(rating * 2) / 2));
}

/**
 * Whether a player fits the picked levels. Your level by default; with no
 * level of your own, every level shows. Players with no level show only when
 * every level is picked (nothing selected).
 */
export function fitsLevels(mine: number | null, theirs: number | null, pick: Exclude<LevelPick, null>): boolean {
  const wanted = pick === "mine" ? (mine == null ? [] : [levelChip(mine)]) : pick;
  if (wanted.length === 0) return true;
  if (theirs == null) return false;
  return wanted.includes(levelChip(theirs));
}

export function fitsLevel(mine: number | null, theirs: number | null, range: LevelRange): boolean {
  if (range === "any" || mine == null) return true;
  if (theirs == null) return false;
  return Math.abs(theirs - mine) <= LEVEL_SPAN[range] + 1e-9;
}

/** "Level 3.0 to 4.0. You're 3.5." under the Level choice, or null when it doesn't apply. */
export function levelRangeText(mine: number | null, range: LevelRange): string | null {
  if (mine == null) return "Add your level in Profile to see players close to it.";
  if (range === "any") return `Every level. You're ${mine.toFixed(1)}.`;
  const span = LEVEL_SPAN[range];
  const lo = Math.max(1, mine - span);
  const hi = Math.min(7, mine + span);
  return `Level ${lo.toFixed(1)} to ${hi.toFixed(1)}. You're ${mine.toFixed(1)}.`;
}

export function fitsPlays(theirs: string | null, want: PlaysFilter): boolean {
  if (want === "either") return true;
  return theirs === want || theirs === "both";
}

export interface DiscoverCandidate {
  userId: number;
  clerkUserId: string;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  point: Point;
  town: string | null;
  plays: string | null;
  /** The old hour grid (F7), read when they haven't saved free times. */
  slots: number[];
  /** Free times from the new editor (decision 156), or null. */
  freeTimes?: FreeRange[] | null;
  /** Their home court's name from the court directory, if they picked one. */
  homeCourt?: string | null;
}

export interface DiscoverPlayerRow {
  userId: number;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  distance: string;
  plays: Plays | null;
  played: number;
  noShows: number;
  reliability: string;
  /** One line for VoiceOver: "Sam Whitfield, level 3.5, about 4 miles away, singles, played 14, 1 no-show". */
  spoken: string;
}

export const playsLabel = (p: string | null): string | null =>
  p === "singles" ? "Singles" : p === "doubles" ? "Doubles" : p === "both" ? "Singles and doubles" : null;

export function spokenRow(p: { name: string; rating: number | null; plays: string | null }, miles: number, r: Pick<Reliability, "played" | "noShows">): string {
  const parts = [p.name];
  if (p.rating != null) parts.push(`level ${p.rating.toFixed(1)}`);
  const m = Math.max(1, Math.round(miles));
  parts.push(`about ${m} mile${m === 1 ? "" : "s"} away`);
  const plays = playsLabel(p.plays);
  if (plays) parts.push(plays.toLowerCase());
  parts.push(reliabilitySpoken(r));
  return parts.join(", ");
}

export interface NearbyResult {
  players: DiscoverPlayerRow[];
  /** How many players each distance chip would show with the other filters as they are. */
  counts: { radius: number; count: number }[];
}

export function nearbyPlayers(
  me: { point: Point; rating: number | null; slots: number[]; freeTimes?: FreeRange[] | null },
  candidates: DiscoverCandidate[],
  filters: PlayerFilters,
  reliability: (clerkUserId: string) => Reliability,
): NearbyResult {
  const mine = timesOf(me);
  const matching = candidates
    .filter(
      (p) =>
        (filters.levels == null
          ? fitsLevel(me.rating, p.rating, filters.level)
          : fitsLevels(me.rating, p.rating, filters.levels)) &&
        fitsPlays(p.plays, filters.plays) &&
        (!filters.free || overlaps(mine, timesOf(p))),
    )
    .map((p) => ({ p, miles: milesBetween(me.point, p.point) }));

  const steps = [...new Set<number>([...RADIUS_STEPS, filters.radius])].sort((a, b) => a - b);
  const counts = steps.map((radius) => ({ radius, count: matching.filter((m) => m.miles <= radius).length }));

  const gap = (r: number | null) => (r == null || me.rating == null ? 99 : Math.abs(r - me.rating));
  const players = matching
    .filter((m) => m.miles <= filters.radius)
    .sort(
      (a, b) =>
        Math.round(a.miles) - Math.round(b.miles) ||
        gap(a.p.rating) - gap(b.p.rating) ||
        a.p.name.localeCompare(b.p.name) ||
        a.p.userId - b.p.userId,
    )
    .map(({ p, miles }) => {
      const r = reliability(p.clerkUserId);
      return {
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        rating: p.rating,
        ratingSource: p.ratingSource,
        distance: distanceLabel(miles),
        plays: isOneOf(PLAYS, p.plays) ? p.plays : null,
        played: r.played,
        noShows: r.noShows,
        reliability: reliabilityLine(r),
        spoken: spokenRow(p, miles, r),
      };
    });

  return { players, counts };
}

export interface DiscoverSettingsInput {
  hidden?: boolean;
  plays?: Plays | null;
  radius?: number;
  matchAlerts?: boolean;
}

export function parseDiscoverSettings(body: unknown): DiscoverSettingsInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: DiscoverSettingsInput = {};
  if (b.hidden !== undefined) {
    if (typeof b.hidden !== "boolean") return { error: "Choose on or off." };
    out.hidden = b.hidden;
  }
  if (b.plays !== undefined) {
    if (b.plays !== null && !isOneOf(PLAYS, b.plays)) return { error: "Pick singles, doubles or both." };
    out.plays = b.plays as Plays | null;
  }
  if (b.matchAlerts !== undefined) {
    if (typeof b.matchAlerts !== "boolean") return { error: "Choose on or off." };
    out.matchAlerts = b.matchAlerts;
  }
  if (b.radius !== undefined) {
    if (typeof b.radius !== "number" || !Number.isFinite(b.radius)) return { error: "Pick a distance from 1 to 30 miles." };
    out.radius = parseRadius(b.radius);
  }
  return out;
}
