// Players near you (spec: Discover). Pure rules, so they're easy to test:
// who shows up, in what order, and how many show at each radius step.
//
// - Always local: nobody farther than the chosen radius (30 miles at most).
// - Approximate distance only: the card says "~4 mi away", never a spot.
// - Sorted by distance (whole miles), then by how close the level is.
// - Level range: ±0.5 by default, widenable to ±1.0 (spec: Self-rated level,
//   Match range), or any level.
// - Plays and Usually free keep players who said so; "Both" counts for
//   singles and doubles. Players who haven't said show under "Any" only.
// - Hidden profiles, blocked players (either side), banned or suspended
//   accounts and the viewer never show. The route filters those out first.

import { DEFAULT_RADIUS, RADIUS_OPTIONS, distanceLabel, milesBetween, type Point, type RadiusMiles } from "./discoverArea.js";

export const LEVEL_RANGES = ["near", "wider", "any"] as const;
export type LevelRange = (typeof LEVEL_RANGES)[number];
/** How far from your level each range reaches. */
export const LEVEL_SPAN: Record<Exclude<LevelRange, "any">, number> = { near: 0.5, wider: 1.0 };

export const PLAYS = ["singles", "doubles", "both"] as const;
export type Plays = (typeof PLAYS)[number];

export const FREE_TIMES = ["weekday_mornings", "weekday_evenings", "weekends"] as const;
export type FreeTime = (typeof FREE_TIMES)[number];

export interface PlayerFilters {
  radius: RadiusMiles;
  level: LevelRange;
  plays: "any" | "singles" | "doubles";
  free: "any" | FreeTime;
}

export const DEFAULT_FILTERS: PlayerFilters = { radius: DEFAULT_RADIUS, level: "near", plays: "any", free: "any" };

export interface DiscoverCandidate {
  userId: number;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  point: Point;
  plays: string | null;
  freeTimes: string[] | null;
  /** Completed matches on Ball Boi. */
  played: number;
  /** Match requests where the other player said they didn't show. */
  noShows?: number;
}

export interface DiscoverPlayerCard {
  userId: number;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  distanceLabel: string;
  plays: Plays | null;
  played: number;
  noShows: number;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** Filters from a query string. Anything unknown falls back to the default. */
export function parseFilters(q: Record<string, unknown>, parseRadius: (raw: unknown) => RadiusMiles): PlayerFilters {
  return {
    radius: parseRadius(q.radius),
    level: isOneOf(LEVEL_RANGES, q.level) ? q.level : DEFAULT_FILTERS.level,
    plays: q.plays === "singles" || q.plays === "doubles" ? q.plays : "any",
    free: isOneOf(FREE_TIMES, q.free) ? q.free : "any",
  };
}

export function fitsLevel(myRating: number | null, theirs: number | null, range: LevelRange): boolean {
  // Without your own level there's nothing to measure from, so every level shows.
  if (range === "any" || myRating == null) return true;
  if (theirs == null) return false;
  // A hair of slack so 3.0 to 3.5 counts as within 0.5 despite float math.
  return Math.abs(theirs - myRating) <= LEVEL_SPAN[range] + 1e-9;
}

export function fitsPlays(theirs: string | null, want: PlayerFilters["plays"]): boolean {
  if (want === "any") return true;
  return theirs === want || theirs === "both";
}

export function fitsFree(theirs: string[] | null, want: PlayerFilters["free"]): boolean {
  if (want === "any") return true;
  return !!theirs?.includes(want);
}

export interface NearbyResult {
  players: DiscoverPlayerCard[];
  /** How many players each radius step would show with the other filters as they are. */
  counts: { radius: RadiusMiles; count: number }[];
}

export function nearbyPlayers(
  me: { point: Point; rating: number | null },
  candidates: DiscoverCandidate[],
  filters: PlayerFilters,
): NearbyResult {
  const matching = candidates
    .filter((p) => fitsLevel(me.rating, p.rating, filters.level) && fitsPlays(p.plays, filters.plays) && fitsFree(p.freeTimes, filters.free))
    .map((p) => ({ p, miles: milesBetween(me.point, p.point) }));

  const counts = RADIUS_OPTIONS.map((radius) => ({ radius, count: matching.filter((m) => m.miles <= radius).length }));

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
    .map(({ p, miles }) => ({
      userId: p.userId,
      name: p.name,
      avatarUrl: p.avatarUrl,
      rating: p.rating,
      ratingSource: p.ratingSource,
      distanceLabel: distanceLabel(miles),
      plays: isOneOf(PLAYS, p.plays) ? p.plays : null,
      played: p.played,
      noShows: p.noShows ?? 0,
    }));

  return { players, counts };
}

/** Discover settings a player saves: hidden profile, what they play, when they're free. */
export interface DiscoverSettingsInput {
  hidden?: boolean;
  plays?: Plays | null;
  freeTimes?: FreeTime[];
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
  if (b.freeTimes !== undefined) {
    if (!Array.isArray(b.freeTimes) || !b.freeTimes.every((t) => isOneOf(FREE_TIMES, t))) {
      return { error: "Pick from the times shown." };
    }
    out.freeTimes = FREE_TIMES.filter((t) => (b.freeTimes as unknown[]).includes(t));
  }
  return out;
}
