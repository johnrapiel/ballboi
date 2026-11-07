// Discover (spec: Discover; Wave 2 Session F, F1 to F14). Pure helpers only,
// so they're testable in Node; the data hooks are hooks/useDiscover*.ts.

export type Plays = "singles" | "doubles" | "both";
export type LevelRange = "close" | "wider" | "any";
export type PlaysFilter = "singles" | "doubles" | "either";
export type DiscoverTab = "players" | "leagues" | "matches";

export interface DiscoverArea {
  zip: string;
  town: string;
  state: string;
}

export interface DiscoverMe {
  area: DiscoverArea | null;
  homeZip: string | null;
  hidden: boolean;
  plays: Plays | null;
  radius: number;
  rating: number | null;
  slots: number[];
  hoursFree: number;
  freeSummary: string | null;
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
  spoken: string;
}

export interface DiscoverPlayers {
  players: DiscoverPlayerRow[];
  counts: { radius: number; count: number }[];
  radius: number;
  total: number;
  needsArea: boolean;
}

export interface DiscoverPlayerCard {
  userId: number;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  town: string | null;
  distance: string | null;
  plays: Plays | null;
  freeSummary: string | null;
  homeCourt: string | null;
  played: number;
  noShows: number;
  wins: number;
  losses: number;
}

export interface PlayerFilters {
  level: LevelRange;
  plays: PlaysFilter;
  free: boolean;
}

export const DEFAULT_FILTERS: PlayerFilters = { level: "close", plays: "either", free: false };

/** The distance chips (spec: 5 / 10 / 15 / 30, 10 by default, 30 at most), plus Custom. */
export const RADIUS_STEPS = [5, 10, 15, 30] as const;
export const DEFAULT_RADIUS = 10;
export const MIN_RADIUS = 1;
export const MAX_RADIUS = 30;

export const isCustomRadius = (r: number) => !(RADIUS_STEPS as readonly number[]).includes(r);

/** A typed or dragged distance, kept to whole miles from 1 to 30. */
export function clampRadius(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.round(n)));
}

/** The address for Players near you. */
export function playersPath(radius: number, f: PlayerFilters): string {
  const q = [`radius=${clampRadius(radius)}`, `level=${f.level}`, `plays=${f.plays}`];
  if (f.free) q.push("free=1");
  return `/api/discover/players?${q.join("&")}`;
}

export const isZip = (s: string) => /^\d{5}$/.test(s.trim());

/** "Near 12590, Wappingers Falls". */
export function areaLine(area: DiscoverArea | null): string {
  return area ? `Near ${area.zip}, ${area.town}` : "Add your ZIP to find players near you";
}

export function countFor(counts: { radius: number; count: number }[], radius: number): number | null {
  return counts.find((c) => c.radius === radius)?.count ?? null;
}

/** "14 players within 10 mi". */
export function countLine(n: number, radius: number, noun: "player" | "Open league" | "open match" = "player"): string {
  const plural = noun === "open match" ? "open matches" : `${noun}s`;
  return `${n} ${n === 1 ? noun : plural} within ${radius} mi`;
}

/** What VoiceOver reads for a distance chip: "10 miles, 14 players, selected". */
export function radiusChipSpoken(radius: number, count: number | null, selected: boolean, noun = "players"): string {
  const parts = [`${radius} mile${radius === 1 ? "" : "s"}`];
  if (count != null) parts.push(`${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`);
  if (selected) parts.push("selected");
  return parts.join(", ");
}

export const LEVEL_SPAN: Record<Exclude<LevelRange, "any">, number> = { close: 0.5, wider: 1.0 };

/** "Level 3.0 to 4.0. You're 3.5." under the Level choice. */
export function levelRangeText(mine: number | null, range: LevelRange): string {
  if (mine == null) return "Add your level in Profile to see players close to it.";
  if (range === "any") return `Every level. You're ${mine.toFixed(1)}.`;
  const span = LEVEL_SPAN[range];
  return `Level ${Math.max(1, mine - span).toFixed(1)} to ${Math.min(7, mine + span).toFixed(1)}. You're ${mine.toFixed(1)}.`;
}

export function playsLabel(p: Plays | null): string | null {
  return p === "singles" ? "Singles" : p === "doubles" ? "Doubles" : p === "both" ? "Singles and doubles" : null;
}

/** "I play" chips: Singles and Doubles, either or both. */
export function playsFromPicks(singles: boolean, doubles: boolean): Plays | null {
  if (singles && doubles) return "both";
  if (singles) return "singles";
  if (doubles) return "doubles";
  return null;
}

export function picksFromPlays(p: Plays | null): { singles: boolean; doubles: boolean } {
  return { singles: p === "singles" || p === "both", doubles: p === "doubles" || p === "both" };
}

/** The line under a name on a Players row: "~4 mi · Singles". */
export function rowDetail(p: Pick<DiscoverPlayerRow, "distance" | "plays">): string {
  return [p.distance, playsLabel(p.plays)].filter(Boolean).join(" · ");
}

/** Record / Played / No-shows on the player card, read as one group. */
export function cardStatsSpoken(p: Pick<DiscoverPlayerCard, "wins" | "losses" | "played" | "noShows">): string {
  return `Record ${p.wins} ${p.wins === 1 ? "win" : "wins"} ${p.losses} ${p.losses === 1 ? "loss" : "losses"}. Played ${p.played}, ${p.noShows} no-show${p.noShows === 1 ? "" : "s"}`;
}

/** "Fishkill · ~4 mi away". */
export function whereLine(p: Pick<DiscoverPlayerCard, "town" | "distance">): string | null {
  const parts = [p.town, p.distance].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Initials for a player with no photo. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}

// ─── When you can play (F7): the hour grid ──────────────────────────────────

export const FIRST_HOUR = 6;
export const LAST_HOUR = 21;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export const slotOf = (day: number, hour: number) => day * 24 + hour;
export const dayOf = (slot: number) => Math.floor(slot / 24);
export const hourOf = (slot: number) => slot % 24;

/** "6a", "12p", "9p" beside each row. */
export function hourShort(h: number): string {
  return h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`;
}

/** "6 AM", "12 PM", "9 PM", for VoiceOver. */
export function hourSpoken(h: number): string {
  return h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
}

/** "Monday 6 PM, free". */
export function cellSpoken(day: number, hour: number, free: boolean): string {
  return `${DAY_NAMES[day]} ${hourSpoken(hour)}, ${free ? "free" : "not free"}`;
}

/** Every slot in an hour row, Monday to Sunday. */
export const rowSlots = (hour: number) => DAY_NAMES.map((_, d) => slotOf(d, hour));

/** A whole row on when any of it is off, otherwise off (the non-drag way to fill a row). */
export function toggleRow(slots: ReadonlySet<number>, hour: number): Set<number> {
  const row = rowSlots(hour);
  const next = new Set(slots);
  const allOn = row.every((s) => next.has(s));
  for (const s of row) {
    if (allOn) next.delete(s);
    else next.add(s);
  }
  return next;
}

/** One cell flipped. */
export function toggleSlot(slots: ReadonlySet<number>, slot: number): Set<number> {
  const next = new Set(slots);
  if (next.has(slot)) next.delete(slot);
  else next.add(slot);
  return next;
}

/** Dragging paints every cell it crosses the way the first cell went. */
export function paintSlot(slots: ReadonlySet<number>, slot: number, on: boolean): Set<number> {
  if (slots.has(slot) === on) return slots as Set<number>;
  const next = new Set(slots);
  if (on) next.add(slot);
  else next.delete(slot);
  return next;
}

/** The cell under a point in the grid, or null outside it. */
export function cellAt(
  x: number,
  y: number,
  layout: { labelWidth: number; cellWidth: number; cellHeight: number; gap: number },
): { day: number; hour: number } | null {
  const col = Math.floor((x - layout.labelWidth) / (layout.cellWidth + layout.gap));
  const row = Math.floor(y / (layout.cellHeight + layout.gap));
  if (x < layout.labelWidth || col < 0 || col > 6 || row < 0 || row >= HOURS.length) return null;
  return { day: col, hour: HOURS[row] };
}

/** "15 hours free". */
export function hoursFreeLine(n: number): string {
  return `${n} hour${n === 1 ? "" : "s"} free`;
}

export function sameSlots(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((s) => a.has(s));
}

// ─── Filters and invites ─────────────────────────────────────────────────────

const LEVEL_WORDS: Record<LevelRange, string> = { close: "close to mine", wider: "wider", any: "any" };
const PLAYS_WORDS: Record<PlaysFilter, string> = { singles: "singles", doubles: "doubles", either: "either" };

/** The Filters button for VoiceOver: "level close to mine, plays either, free when I'm free off". */
export function filtersSpoken(f: PlayerFilters): string {
  return `level ${LEVEL_WORDS[f.level]}, plays ${PLAYS_WORDS[f.plays]}, free when I'm free ${f.free ? "on" : "off"}`;
}

export const sameFilters = (a: PlayerFilters, b: PlayerFilters) => a.level === b.level && a.plays === b.plays && a.free === b.free;

/** Ball Boi's home on the web; opens the app when it's installed. */
export const INVITE_LINK = "https://ballboi.tennis";

/** What "Invite a friend" fills into the iOS share sheet. */
export function inviteMessage(zip: string | null): string {
  return `Play tennis with me on Ball Boi. I'm finding matches${zip ? ` near ${zip}` : ""}. Join me so we can play: ${INVITE_LINK}`;
}

// ─── Open leagues (brief items 17 to 22) ─────────────────────────────────────

export type LeagueTag = "outside_level" | "full" | "started";
export type LeagueRequest = { kind: "request" | "waitlist"; status: "pending" | "declined" } | null;

export interface DiscoverLeagueCard {
  leagueId: number;
  name: string;
  detail: string;
  status: string;
  tags: LeagueTag[];
  joining: "request" | "waitlist";
  myRequest: LeagueRequest;
  spoken: string;
}

export interface DiscoverLeagues {
  leagues: DiscoverLeagueCard[];
  counts: { radius: number; count: number }[];
  radius: number;
  total: number;
  needsArea: boolean;
}

export interface DiscoverLeague {
  leagueId: number;
  name: string;
  organizerName: string;
  location: string | null;
  distance: string | null;
  format: string;
  type: string;
  levelText: string;
  outsideLevel: boolean;
  myRating: number | null;
  startDate: string | null;
  startLabel: string | null;
  seasonWeeks: number | null;
  started: boolean;
  full: boolean;
  rosterCap: number | null;
  spotsTaken: number;
  spotsLeft: number | null;
  joining: "request" | "waitlist";
  myRequest: LeagueRequest;
  member: boolean;
}

export const leaguesPath = (radius: number) => `/api/discover/leagues?radius=${clampRadius(radius)}`;

/** A tag's words: always text with its icon, never color alone. */
export function leagueTagLabel(t: LeagueTag): string {
  return t === "outside_level" ? "Outside your level" : t === "full" ? "Full" : "Season started";
}

/** The organizer's first name, for "Dave approves requests…". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Where you stand with an Open league, for its page. */
export type LeagueStanding = "member" | "requested" | "waitlisted" | "declined" | "request" | "waitlist";

export function leagueStanding(l: Pick<DiscoverLeague, "member" | "myRequest" | "joining">): LeagueStanding {
  if (l.member) return "member";
  if (l.myRequest?.status === "pending") return l.myRequest.kind === "waitlist" ? "waitlisted" : "requested";
  if (l.myRequest?.status === "declined") return "declined";
  return l.joining;
}

/** "Starts Sun, Nov 22 · 8 weeks" or "Started Sun, Nov 1 · 8 weeks". */
export function seasonLine(l: Pick<DiscoverLeague, "startLabel" | "seasonWeeks" | "started">): string {
  const start = l.startLabel ? `${l.started ? "Started" : "Starts"} ${l.startLabel}` : "Start date not set yet";
  return l.seasonWeeks ? `${start} · ${l.seasonWeeks} weeks` : start;
}

/** "13 of 16 taken · 3 left", or null with no roster cap. */
export function spotsLine(l: Pick<DiscoverLeague, "rosterCap" | "spotsTaken" | "spotsLeft">): string | null {
  if (!l.rosterCap) return null;
  return `${l.spotsTaken} of ${l.rosterCap} taken · ${l.spotsLeft ?? 0} left`;
}

// ─── Court directory (F4) ────────────────────────────────────────────────────

export interface CourtCard {
  courtId: number;
  name: string;
  address: string;
  distance: string | null;
}

export const courtsPath = (q: string) => {
  const t = q.trim().replace(/\s+/g, " ").slice(0, 60);
  return t ? `/api/courts?q=${encodeURIComponent(t)}` : "/api/courts";
};

/** "Beacon Courts · ~3 mi". */
export function courtLine(c: Pick<CourtCard, "name" | "distance">): string {
  return c.distance ? `${c.name} · ${c.distance}` : c.name;
}

/** VoiceOver: "Beacon Courts, about 3 miles away, Memorial Park, Beacon NY 12508". */
export function courtSpoken(c: CourtCard, selected: boolean): string {
  const miles = c.distance ? Number(c.distance.replace(/\D/g, "")) : null;
  return [c.name, miles != null ? `about ${miles} mile${miles === 1 ? "" : "s"} away` : null, c.address, selected ? "selected" : null]
    .filter(Boolean)
    .join(", ");
}
