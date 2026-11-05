// Discover helpers (spec: Discover). Pure, so they're tested in Node.
// The server does the filtering; these only word what the app shows.

import type {
  CourtCard,
  DiscoverFilters,
  DiscoverPlayerCard,
  DiscoverPlayersCountsItem,
  DiscoverSettingsFreeTimesItem,
  DiscoverSettingsPlays,
} from "@workspace/api-client-react";

export type Plays = NonNullable<DiscoverSettingsPlays>;
export type FreeTime = DiscoverSettingsFreeTimesItem;
export type Radius = DiscoverFilters["radius"];
export type LevelRange = DiscoverFilters["level"];

export const RADII: Radius[] = [5, 10, 15, 30];
export const DEFAULT_FILTERS: DiscoverFilters = { radius: 10, level: "near", plays: "any", free: "any" };

export const PLAYS_LABEL: Record<Plays, string> = {
  singles: "Singles",
  doubles: "Doubles",
  both: "Singles and doubles",
};

export const FREE_TIMES: FreeTime[] = ["weekday_mornings", "weekday_evenings", "weekends"];
export const FREE_LABEL: Record<FreeTime, string> = {
  weekday_mornings: "Weekday mornings",
  weekday_evenings: "Weekday evenings",
  weekends: "Weekends",
};

/** How far each level range reaches from your own level, matching the server. */
const LEVEL_SPAN: Record<Exclude<LevelRange, "any">, number> = { near: 0.5, wider: 1.0 };
const MIN_LEVEL = 1.0;
const MAX_LEVEL = 7.0;

const one = (n: number) => n.toFixed(1);

/** "3.0 to 4.0" for a 3.5 player on the near range, or "Any level". */
export function levelRangeLabel(level: LevelRange, myRating: number | null | undefined): string {
  if (level === "any" || myRating == null) return "Any level";
  const span = LEVEL_SPAN[level];
  return `${one(Math.max(MIN_LEVEL, myRating - span))} to ${one(Math.min(MAX_LEVEL, myRating + span))}`;
}

/** The short chips across the top of Discover, in the order the canvas shows them. */
export function filterChips(filters: DiscoverFilters, myRating: number | null | undefined): string[] {
  const chips = [`Within ${filters.radius} mi`, levelRangeLabel(filters.level, myRating)];
  if (filters.plays !== "any") chips.push(PLAYS_LABEL[filters.plays]);
  if (filters.free !== "any") chips.push(FREE_LABEL[filters.free]);
  return chips;
}

/** How many players a radius step would show, or null when the server didn't say. */
export function countAt(counts: DiscoverPlayersCountsItem[], radius: number): number | null {
  return counts.find((c) => c.radius === radius)?.count ?? null;
}

const players = (n: number) => `${n} ${n === 1 ? "player" : "players"}`;

/** A radius option in the Filters sheet: "15 mi · 4", read as "Within 15 miles, 4 players". */
export function radiusOption(radius: Radius, count: number | null): { label: string; spoken: string } {
  return count == null
    ? { label: `${radius} mi`, spoken: `Within ${radius} miles` }
    : { label: `${radius} mi · ${count}`, spoken: `Within ${radius} miles, ${players(count)}` };
}

/** The nearest wider radius that would show someone, for the empty state. */
export function widerRadius(counts: DiscoverPlayersCountsItem[], radius: Radius): { radius: Radius; count: number } | null {
  for (const r of RADII) {
    if (r <= radius) continue;
    const n = countAt(counts, r);
    if (n && n > 0) return { radius: r, count: n };
  }
  return null;
}

/** The line under a player's name: "3.5 · ~2 mi away · Played 12". */
export function playerLine(p: Pick<DiscoverPlayerCard, "rating" | "distanceLabel" | "played">): string {
  return [p.rating == null ? "Level not set" : one(p.rating), p.distanceLabel, `Played ${p.played}`].join(" · ");
}

/** What VoiceOver reads for a player row. */
export function playerSpoken(p: Pick<DiscoverPlayerCard, "name" | "rating" | "distanceLabel" | "played">): string {
  const level = p.rating == null ? "level not set" : `level ${one(p.rating)}`;
  const n = Number(/(\d+)/.exec(p.distanceLabel)?.[1]);
  const away = /^under/i.test(p.distanceLabel)
    ? "under 1 mile away"
    : Number.isFinite(n)
      ? `about ${n} ${n === 1 ? "mile" : "miles"} away`
      : p.distanceLabel;
  return `${p.name}, ${level}, ${away}, played ${p.played} ${p.played === 1 ? "match" : "matches"}`;
}

/** Adds or removes one usually-free time, keeping the order the app lists them in. */
export function toggleFreeTime(list: FreeTime[], item: FreeTime): FreeTime[] {
  const next = list.includes(item) ? list.filter((t) => t !== item) : [...list, item];
  return FREE_TIMES.filter((t) => next.includes(t));
}

/** "Weekday evenings and weekends", or null when none are set. */
export function freeTimesLine(list: FreeTime[]): string | null {
  const words = FREE_TIMES.filter((t) => list.includes(t)).map((t, i) => (i === 0 ? FREE_LABEL[t] : FREE_LABEL[t].toLowerCase()));
  if (!words.length) return null;
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Filters saved on the phone, checked, falling back to the defaults for anything unknown. */
export function readSavedFilters(raw: string | null | undefined): DiscoverFilters {
  if (!raw) return DEFAULT_FILTERS;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_FILTERS;
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    radius: pick(o.radius, RADII, DEFAULT_FILTERS.radius),
    level: pick(o.level, ["near", "wider", "any"] as const, DEFAULT_FILTERS.level),
    plays: pick(o.plays, ["any", "singles", "doubles"] as const, DEFAULT_FILTERS.plays),
    free: pick(o.free, ["any", ...FREE_TIMES] as const, DEFAULT_FILTERS.free),
  };
}

/** The text shared by Invite a friend. No App Store link until the app is listed. */
export const INVITE_MESSAGE = "I'm finding tennis players near me on Ball Boi. Get the app so we can play.";

// ─── Open leagues (Discover PR 2) ────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Nov 2" from "2026-11-02", read as the calendar date it names. */
export function shortDay(date: string, long = false): string {
  const [, m, d] = date.split("-").map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${d}`;
}

export const FORMAT_LABEL: Record<"flex" | "round_robin", string> = { flex: "Flex", round_robin: "Round robin" };

type LeagueCardFields = {
  format: "flex" | "round_robin";
  levelRange: string;
  startDate: string | null;
  distanceLabel: string;
  spotsLeft: number | null;
  joining: "join" | "waitlist";
  myRequest: "request" | "waitlist" | null;
};

/** The canvas line under a league's name: "~6 mi away · Round robin · 3.0 to 4.0 · Starts Nov 2". */
export function leagueLine(l: LeagueCardFields, today: string): string {
  const parts = [l.distanceLabel, FORMAT_LABEL[l.format], l.levelRange];
  if (l.startDate) parts.push(`${l.startDate > today ? "Starts" : "Started"} ${shortDay(l.startDate)}`);
  return parts.join(" · ");
}

/** The tag beside a league's name: where you stand, or how many spots are left. */
export function leagueTag(l: LeagueCardFields): string {
  if (l.myRequest === "request") return "Requested";
  if (l.myRequest === "waitlist") return "On the waitlist";
  if (l.joining === "waitlist") return l.spotsLeft === 0 ? "Full" : "Waitlist";
  if (l.spotsLeft == null) return "Open";
  return `${l.spotsLeft} ${l.spotsLeft === 1 ? "spot" : "spots"} left`;
}

/** The preview's button for a league you haven't asked to join. */
export function joinButtonLabel(l: Pick<LeagueCardFields, "joining">): string {
  return l.joining === "join" ? "Request to join" : "Join the waitlist";
}

/** Today on this phone, as "YYYY-MM-DD". */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ─── Court directory ───────────────────────────────────────────────────────

type CourtFields = Pick<CourtCard, "access" | "surface" | "lights" | "courtCount" | "distanceLabel">;

export const COURT_SURFACE_LABEL: Record<NonNullable<CourtCard["surface"]>, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  other: "Other surface",
};

/** "Public · Hard · 4 courts · Lights · ~2 mi away", leaving out what nobody said. */
export function courtLine(c: CourtFields): string {
  return [
    c.access === "club" ? "Club" : "Public",
    c.surface ? COURT_SURFACE_LABEL[c.surface] : null,
    c.courtCount ? `${c.courtCount} ${c.courtCount === 1 ? "court" : "courts"}` : null,
    c.lights === true ? "Lights" : c.lights === false ? "No lights" : null,
    c.distanceLabel || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Courts whose name or place has every word typed, in the order given. */
export function searchCourts<T extends Pick<CourtCard, "name" | "place">>(courts: T[], text: string): T[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return courts;
  return courts.filter((c) => {
    const hay = `${c.name} ${c.place ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A typed court count: blank is "not sure", otherwise a whole number from 1 to 60. */
export function parseCourtCount(text: string): number | null | "invalid" {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : "invalid";
}
