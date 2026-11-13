// Discover (spec: Discover; Wave 2 Session F, F1 to F14). Pure helpers only,
// so they're testable in Node; the data hooks are hooks/useDiscover*.ts.

import type { FreeRange } from "@workspace/free-times";
import { clockTime } from "./timeFormat";

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
  /** The old hour grid as saved; read freeTimes. */
  slots: number[];
  /** Your free times, or your old hour grid converted exactly. */
  freeTimes: FreeRange[];
  hoursFree: number;
  freeSummary: string | null;
  matchAlerts?: boolean;
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

/** Every level, as chips in Filters (spec decision 86: 2.5 to 5.0). */
export const FILTER_LEVELS = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;

/**
 * The Level filter (John, Nov 7): every level listed, pick any number, and
 * yours selected by default. "mine" is that default; a list is what you
 * picked, and an empty list means every level.
 */
export type LevelPick = "mine" | number[];

export interface PlayerFilters {
  levels: LevelPick;
  plays: PlaysFilter;
  free: boolean;
}

export const DEFAULT_FILTERS: PlayerFilters = { levels: "mine", plays: "either", free: false };

/** A rating on the chips' scale: the nearest half point, 2.5 to 5.0. */
export function levelChip(rating: number): number {
  return Math.min(5, Math.max(2.5, Math.round(rating * 2) / 2));
}

/** The chips that show selected: your own level by default (none if you have no level). */
export function pickedLevels(pick: LevelPick, mine: number | null): number[] {
  if (pick !== "mine") return pick;
  return mine == null ? [] : [levelChip(mine)];
}

/** Tapping a level chip: switch it on or off, keeping the chips in order. */
export function toggleLevel(pick: LevelPick, mine: number | null, level: number): number[] {
  const now = pickedLevels(pick, mine);
  const next = now.includes(level) ? now.filter((l) => l !== level) : [...now, level];
  return next.sort((a, b) => a - b);
}

/** The line under the chips: "Showing 3.5, your level.", "Showing 3.0, 3.5 and 4.0.", "Showing every level." */
export function levelsText(pick: LevelPick, mine: number | null): string {
  const picked = pickedLevels(pick, mine);
  if (picked.length === 0) return mine == null ? "Showing every level. Add your level in Profile." : "Showing every level.";
  const words = picked.map((l) => l.toFixed(1));
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  const yours = mine != null && picked.length === 1 && picked[0] === levelChip(mine) ? ", your level" : "";
  return `Showing ${list}${yours}.`;
}

/** The distance chips (spec: 5 / 10 / 15 / 30 / 50, 10 by default, 50 at most; decision 196), plus Custom. */
export const RADIUS_STEPS = [5, 10, 15, 30, 50] as const;
export const DEFAULT_RADIUS = 10;
export const MIN_RADIUS = 1;
export const MAX_RADIUS = 50;

export const isCustomRadius = (r: number) => !(RADIUS_STEPS as readonly number[]).includes(r);

/** A typed or dragged distance, kept to whole miles from 1 to 50. */
export function clampRadius(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.round(n)));
}

/** The address for Players near you. */
export function playersPath(radius: number, f: PlayerFilters): string {
  const levels = f.levels === "mine" ? "mine" : f.levels.map((l) => l.toFixed(1)).join(",");
  const q = [`radius=${clampRadius(radius)}`, `levels=${levels}`, `plays=${f.plays}`];
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

/**
 * The empty state's "Widen to N mi" step (#260): the next chip out that has
 * someone, else the next chip out. Nothing past 50 mi, so no Widen at 50.
 */
export function widenStep(radius: number, counts: { radius: number; count: number }[]): number | null {
  const wider = RADIUS_STEPS.filter((r) => r > radius);
  return wider.find((r) => (countFor(counts, r) ?? 0) > 0) ?? wider[0] ?? null;
}

/** "14 players within 10 mi". */
export function countLine(
  n: number,
  radius: number,
  noun: "player" | "Open league" | "Open singles league" | "Open doubles league" | "open match" = "player",
): string {
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

/** Initials for a player with no photo. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}

// ─── Free times: see lib/freeTimes.ts (decision 156; the F7 hour grid is gone)

// ─── Filters and invites ─────────────────────────────────────────────────────

const PLAYS_WORDS: Record<PlaysFilter, string> = { singles: "singles", doubles: "doubles", either: "either" };

/** The Filters button for VoiceOver: "distance 10 miles, your level, plays either, free when I'm free off". */
export function filtersSpoken(f: PlayerFilters, radius: number): string {
  const level =
    f.levels === "mine" ? "your level" : f.levels.length === 0 ? "every level" : `level ${f.levels.map((l) => l.toFixed(1)).join(", ")}`;
  return `distance ${radius} miles, ${level}, plays ${PLAYS_WORDS[f.plays]}, free when I'm free ${f.free ? "on" : "off"}`;
}

/** Which Players filters are narrowing the list, compared with the defaults. */
export type FilterKey = "free" | "levels" | "plays";

/**
 * The filters that are on (decision 190). Distance isn't one: it has its own
 * Widen. "Your level" is the default, and "every level" is wider than it, so
 * only a level list you picked counts.
 */
export function activeFilters(f: PlayerFilters): FilterKey[] {
  const on: FilterKey[] = [];
  if (f.free) on.push("free");
  if (f.levels !== "mine" && f.levels.length > 0) on.push("levels");
  if (f.plays !== "either") on.push("plays");
  return on;
}

/** The Filters button for VoiceOver: "Filters, 1 on: distance 10 miles, …"; with none on, "Filters: …". */
export function filtersButtonLabel(f: PlayerFilters, radius: number): string {
  const n = activeFilters(f).length;
  return `Filters${n > 0 ? `, ${n} on` : ""}: ${filtersSpoken(f, radius)}`;
}

function listWords(items: string[], joiner: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

/**
 * The filtered empty state's body, naming the filters in plain words:
 * "Nobody nearby is free when you are." or "Nobody nearby plays singles and
 * is free when you are."
 */
export function filteredEmptyBody(f: PlayerFilters): string {
  const parts: string[] = [];
  for (const key of activeFilters(f)) {
    if (key === "plays") parts.push(`plays ${PLAYS_WORDS[f.plays]}`);
    if (key === "levels" && f.levels !== "mine") {
      const levels = f.levels.map((l) => l.toFixed(1));
      parts.push(`is ${levels.length === 1 ? "level" : "at levels"} ${listWords(levels, "or")}`);
    }
    if (key === "free") parts.push("is free when you are");
  }
  if (parts.length === 0) return "Nobody nearby matches your filters.";
  return `Nobody nearby ${listWords(parts, "and")}.`;
}

/** Filters with the narrowing ones cleared; distance stays as it is. */
export const clearedFilters = (): PlayerFilters => ({ ...DEFAULT_FILTERS });

const levelsKey = (p: LevelPick) => (p === "mine" ? "mine" : p.join(","));
export const sameFilters = (a: PlayerFilters, b: PlayerFilters) =>
  levelsKey(a.levels) === levelsKey(b.levels) && a.plays === b.plays && a.free === b.free;

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
  /** D8: a doubles league, shown with the Doubles pill. Older servers leave it out. */
  doubles?: boolean;
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
  /** Doubles (D1): "Fixed partners" or "Rotating partners"; null for singles. */
  partners?: string | null;
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

/** D8: Discover's Format filter for Open leagues. */
export type PlayFilter = "all" | "singles" | "doubles";

export const leaguesPath = (radius: number, play: PlayFilter = "all") =>
  `/api/discover/leagues?radius=${clampRadius(radius)}${play === "all" ? "" : `&play=${play}`}`;

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

// ─── Setting up a match in chat (F2, F12, F13) ───────────────────────────────

export type PlanAction = "accept" | "decline" | "undo" | "still_on" | "cancel" | "score" | "no_show" | "not_played" | "dispute" | "admit";

export interface PlanEvent {
  key: string;
  type:
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
  at: string;
  by: "me" | "them" | null;
  actions: PlanAction[];
  state?: string;
  meIn?: boolean;
  themIn?: boolean;
  about?: "me" | "them";
  deadline?: string;
}

export interface MatchPlan {
  id: number;
  startsAt: string;
  timeZone: string;
  courtName: string | null;
  kind: "singles" | "practice";
  matchId: number | null;
  score: string | null;
  mine: boolean;
  events: PlanEvent[];
}

/** "Thu, Nov 12 at 6 PM", in this phone's time zone. */
export function planWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = clockTime(d);
  return `${day} at ${time}`;
}

/** "6 PM" or "6:30 PM". */
export function planTime(iso: string): string {
  return clockTime(new Date(iso));
}

export const kindLabel = (k: MatchPlan["kind"]) => (k === "practice" ? "Practice hit" : "Singles");

/** "Fishkill Rec Park · Singles", or "Court not set · Singles". */
export function planDetail(p: Pick<MatchPlan, "courtName" | "kind">): string {
  return `${p.courtName ?? "Court not set"} · ${kindLabel(p.kind)}`;
}

/** The words on each chat card for this viewer (canvas W2_Chat*). */
export function eventCopy(e: PlanEvent, p: MatchPlan, other: string): { title: string; body: string | null; status?: boolean } {
  const when = planWhen(p.startsAt);
  const them = other.split(" ")[0] || other;
  switch (e.type) {
    case "proposed":
      if (e.state === "replaced") return { title: "Replaced by a newer time", body: `${when} · ${planDetail(p)}` };
      if (e.state === "declined" || e.state === "undone" || e.state === "added")
        return { title: e.by === "me" ? "You sent a match" : `${them} sent a match`, body: `${when} · ${planDetail(p)}` };
      return e.by === "me"
        ? { title: when, body: `${planDetail(p)}. Waiting for ${them}.` }
        : { title: "Add this match?", body: `${when} · ${planDetail(p)}. It goes on both your schedules.` };
    case "declined":
      return {
        title: e.by === "me" ? "You can't make it" : `${them} can't make it`,
        body: `${when}. Send another time when you find one.`,
        status: true,
      };
    case "added":
      return {
        title: "Match added",
        body: `${when} · ${planDetail(p)}. It's on both your schedules.${e.actions.includes("undo") ? " Either of you can undo it for a few minutes." : ""}`,
      };
    case "undone":
      return { title: `${e.by === "me" ? "You" : them} undid ${when}`, body: "It's off both your schedules.", status: true };
    case "day_before":
      return {
        title: `Still on for tomorrow at ${planTime(p.startsAt)}?`,
        body: `${when} · ${p.courtName ?? "Court not set"} · with ${them}${e.themIn ? `\n${them} is in` : ""}${e.meIn ? "\nYou're in" : ""}\nNo answer means you're still on. We'll remind you 2 hours before.`,
      };
    case "canceled":
      return {
        title: `${e.by === "me" ? "You" : them} canceled ${when}`,
        body: "It's off both your schedules. Canceling before a match never counts as a no-show.",
        status: true,
      };
    case "did_it_happen":
      return { title: `Did your match with ${them} happen?`, body: `${when} · ${p.courtName ?? "Court not set"}` };
    case "not_played":
      return {
        title: `${e.by === "me" ? "You" : them} said you didn't play`,
        body: "It's off both your schedules. Nothing goes on either card.",
        status: true,
      };
    case "no_show_reported": {
      const by = e.deadline ? planWhen(e.deadline) : "";
      return e.about === "me"
        ? {
            title: `${them} says you didn't show`,
            body: `${when} · ${p.courtName ?? "Court not set"}.${e.actions.length ? ` If that's not right, tell us by ${by}. Otherwise a no-show goes on your player card.` : ""}`,
          }
        : {
            title: `You said ${them} didn't show`,
            body: `We asked ${them}. If they don't say otherwise by ${by}, a no-show goes on their player card.`,
          };
    }
    case "no_show_disputed":
      return { title: "You two remember this differently, so we've left it off both cards.", body: null, status: true };
    case "no_show_confirmed":
      return e.about === "me"
        ? { title: "A no-show is on your player card", body: `For ${when}.`, status: true }
        : { title: `A no-show is on ${them}'s player card`, body: `For ${when}.`, status: true };
    case "scored":
      return { title: "Score is in", body: p.score ? `${when} · ${p.score}` : when, status: true };
  }
}

/** The button words for each answer. */
export function actionLabel(a: PlanAction, them: string): string {
  switch (a) {
    case "accept":
    case "still_on":
      return "I'm in";
    case "decline":
    case "cancel":
      return "Can't make it";
    case "undo":
      return "Undo";
    case "score":
      return "Enter the score";
    case "no_show":
      return "They didn't show";
    case "not_played":
      return "We didn't play";
    case "dispute":
      return "That's not right";
    case "admit":
      return "I couldn't make it";
  }
}

/**
 * Splits a card's answers for the screen (Wave 2 finding 46): Can't make it
 * (cancel or decline) is the X in the card's corner, and the rest stay
 * buttons, the first one primary.
 */
export function cardActions(actions: readonly PlanAction[]): { cantMakeIt: PlanAction | null; buttons: PlanAction[] } {
  const isCant = (a: PlanAction) => a === "cancel" || a === "decline";
  return { cantMakeIt: actions.find(isCant) ?? null, buttons: actions.filter((a) => !isCant(a)) };
}

/** A new card starts tomorrow at 6 PM, the most common time to play after work. */
export function defaultPlanStart(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

// ─── Open matches (F6; brief items 38 to 46) ─────────────────────────────────

export type OpenMatchTag = "your_post" | "youre_in" | "need";

export interface OpenMatchCard {
  id: number;
  when: string;
  detail: string;
  where: string;
  tags: OpenMatchTag[];
  need: number | null;
  spoken: string;
}

export interface OpenMatchList {
  matches: OpenMatchCard[];
  counts: { radius: number; count: number }[];
  radius: number;
  total: number;
  needsArea: boolean;
  matchAlerts: boolean;
  notices: { id: number; when: string; courtName: string | null; format: string }[];
}

export interface OpenMatchPlayer {
  userId: number;
  name: string;
  rating: number | null;
  poster: boolean;
  me: boolean;
  /** Their photo ("/objects/..."); older servers don't send it. */
  avatarUrl?: string | null;
}

export interface OpenMatchDetail {
  id: number;
  when: string;
  startsAt: string;
  endsAt: string;
  format: "singles" | "doubles";
  levelText: string;
  courtName: string | null;
  distance: string | null;
  note: string | null;
  status: string;
  spots: number;
  spotsLeft: number;
  total: number;
  players: OpenMatchPlayer[];
  role: "poster" | "in" | "none";
  started: boolean;
  chatTitle: string;
  /** The group chat in Messages (F15), once every spot has filled. */
  chatId: number | null;
  matchId: number | null;
}

export const openMatchesPath = (radius: number) => `/api/open-matches?radius=${clampRadius(radius)}`;

/** "Need 2", the doubles tag (F6). */
export const needLabel = (n: number) => `Need ${n}`;

/** The detail screen's second line (walkthrough 57): "Singles · 1 spot left", "Doubles · Need 3", or "Singles · Full". */
export function openMatchFormatLine(m: Pick<OpenMatchDetail, "format" | "status" | "spotsLeft">): string {
  const format = m.format === "doubles" ? "Doubles" : "Singles";
  const status =
    m.status === "full" || m.spotsLeft <= 0
      ? "Full"
      : m.format === "doubles"
        ? needLabel(m.spotsLeft)
        : `${m.spotsLeft} ${m.spotsLeft === 1 ? "spot" : "spots"} left`;
  return `${format} · ${status}`;
}

const DAY_WORDS: Record<string, string> = {
  Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday",
};
const MONTH_WORDS: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
  Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
};

/** VoiceOver for "Fri, Nov 13 · 6 to 8 PM": "Friday, November 13, 6 to 8 PM". */
export function whenSpoken(when: string): string {
  return when
    .replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/, (d) => DAY_WORDS[d] ?? d)
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/, (mo) => MONTH_WORDS[mo] ?? mo)
    .replace(" · ", ", ");
}

/** "Who's in · 3 of 4". */
export function whosInLine(m: Pick<OpenMatchDetail, "total" | "spotsLeft">): string {
  return `Who's in · ${m.total - m.spotsLeft} of ${m.total}`;
}

/** "2 spots left. We'll open a group chat when they fill, and let you know." */
export function waitingLine(left: number): string {
  return `${left} ${left === 1 ? "spot" : "spots"} left. We'll open a group chat when ${left === 1 ? "it fills" : "they fill"}, and let you know.`;
}

/** The open match form's window: a start, and an end the given hours later. */
export function windowEnd(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * 3_600_000);
}

/**
 * The line under "Court not set" in the Court sheet (Wave 2 finding 51): a
 * one-on-one chat's Add a match (`chat` "dm") says "your chat"; open matches,
 * leagues, doubles and group chats keep "the group chat".
 */
export function courtNotSetLine(chat: string | undefined): string {
  return chat === "dm" ? "Decide the court in your chat" : "Decide the court in the group chat";
}
