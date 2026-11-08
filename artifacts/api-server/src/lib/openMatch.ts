// Open matches (spec: Discover > Open matches; F6; brief items 38 to 46).
// Pure rules; lib/openMatchRepo.ts fetches and saves.
//
// - A post has a day and time window, Singles (1 spot) or Doubles (1 to 3
//   spots), a level range (a guide: anyone can still join), an optional
//   court and an optional note. A time that has passed is refused.
// - Doubles posts show "Need 1" / "Need 2" / "Need 3" while spots are open.
// - First come, first served: the last spot fills it, opens a group chat
//   for everyone, and puts it on their schedules. Dropping out or being
//   removed reopens the spot. A removed player only hears "This match filled
//   up", never "removed".
// - "Alerts for new posts" go to players near the post whose level fits,
//   at most 2 a day each.

import { RADIUS_STEPS, distanceLabel, milesBetween, type Point } from "./discoverArea.js";

export const ALERTS_PER_DAY = 2;
export const MAX_WINDOW_HOURS = 6;
export const MAX_DAYS_AHEAD = 60;
export const PAST_TIME = "That time has passed. Pick a later time.";

const H = 3_600_000;
const LINKISH = /(https?:\/\/|www\.|\.(com|net|org|io|co)\b|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})/i;

export type Format = "singles" | "doubles";
export type LevelChoice = "close" | "wider" | "any";

export interface NewOpenMatch {
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  format: Format;
  spots: number;
  minRating: number | null;
  maxRating: number | null;
  courtId: number | null;
  note: string | null;
}

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The level range a choice gives around your level: Close to mine ±0.5, Wider ±1.0, or Any. */
export function levelRange(choice: LevelChoice, mine: number | null): { min: number | null; max: number | null } {
  if (choice === "any" || mine == null) return { min: null, max: null };
  const span = choice === "close" ? 0.5 : 1.0;
  return { min: Math.max(1, mine - span), max: Math.min(7, mine + span) };
}

export function parseNewOpenMatch(body: unknown, now: Date, myRating: number | null): NewOpenMatch | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const startsAt = typeof b.startsAt === "string" ? new Date(b.startsAt) : null;
  const endsAt = typeof b.endsAt === "string" ? new Date(b.endsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime()) || !endsAt || Number.isNaN(endsAt.getTime())) return { error: "Pick a day and a time window." };
  if (startsAt.getTime() <= now.getTime()) return { error: PAST_TIME };
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * H) return { error: `Pick a day in the next ${MAX_DAYS_AHEAD} days.` };
  if (endsAt <= startsAt) return { error: "The window has to end after it starts." };
  if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_HOURS * H) return { error: `Keep the window to ${MAX_WINDOW_HOURS} hours or less.` };
  const format: Format | null = b.format === "doubles" ? "doubles" : b.format === "singles" || b.format === undefined ? "singles" : null;
  if (!format) return { error: "Pick Singles or Doubles." };
  let spots = 1;
  if (format === "doubles") {
    spots = typeof b.spots === "number" && Number.isInteger(b.spots) ? b.spots : NaN;
    if (!(spots >= 1 && spots <= 3)) return { error: "Doubles needs 1 to 3 open spots." };
  }
  const level: LevelChoice = b.level === "wider" || b.level === "any" ? b.level : "close";
  const { min, max } = levelRange(level, myRating);
  const courtId = b.courtId == null ? null : Number.isInteger(b.courtId) && (b.courtId as number) > 0 ? (b.courtId as number) : NaN;
  if (Number.isNaN(courtId)) return { error: "Pick a court from the list, or leave it not set." };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().replace(/\s+/g, " ") : null;
  if (note && note.length > 200) return { error: "Keep the note to 200 characters." };
  if (note && LINKISH.test(note)) return { error: "Notes can't include links or phone numbers." };
  const timeZone = typeof b.timeZone === "string" && isZone(b.timeZone) ? b.timeZone : "America/New_York";
  return { startsAt, endsAt, timeZone, format, spots, minRating: min, maxRating: max, courtId, note };
}

/** "Sat, Nov 14 · 9 to 11 AM" in the post's time zone. */
export function windowLabel(start: Date, end: Date, timeZone: string): string {
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  const part = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(":00", "");
  const [s, sp] = part(start).split(" ");
  const [e, ep] = part(end).split(" ");
  return `${day} · ${sp === ep ? s : `${s} ${sp}`} to ${e} ${ep}`;
}

export function levelText(min: number | null, max: number | null): string {
  if (min != null && max != null) return `Level ${min.toFixed(1)} to ${max.toFixed(1)}`;
  if (min != null) return `Level ${min.toFixed(1)} and up`;
  if (max != null) return `Level up to ${max.toFixed(1)}`;
  return "Any level";
}

/** Whether a level fits a post's range (a guide for alerts; anyone can still join). */
export function fitsRange(rating: number | null, min: number | null, max: number | null): boolean {
  if (rating == null) return true;
  return (min == null || rating >= min - 1e-9) && (max == null || rating <= max + 1e-9);
}

export interface OpenMatchRow {
  id: number;
  posterClerkUserId: string;
  posterName: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  courtName: string | null;
  format: string;
  spots: number;
  minRating: number | null;
  maxRating: number | null;
  note: string | null;
  status: string;
  point: Point;
  /** Accounts holding a spot now, poster not included. */
  joined: string[];
}

export const spotsLeft = (m: Pick<OpenMatchRow, "spots" | "joined">) => Math.max(0, m.spots - m.joined.length);

export type MatchTag = "your_post" | "youre_in" | "need";

export interface OpenMatchCard {
  id: number;
  when: string;
  detail: string;
  where: string;
  tags: MatchTag[];
  need: number | null;
  spoken: string;
}

export function openMatchCard(viewer: string, myPoint: Point, m: OpenMatchRow): OpenMatchCard & { miles: number } {
  const miles = milesBetween(myPoint, m.point);
  const left = spotsLeft(m);
  const mine = m.posterClerkUserId === viewer;
  const tags: MatchTag[] = [];
  if (mine) tags.push("your_post");
  else if (m.joined.includes(viewer)) tags.push("youre_in");
  const need = m.format === "doubles" && m.status === "open" && left > 0 ? left : null;
  if (need) tags.push("need");
  const when = windowLabel(m.startsAt, m.endsAt, m.timeZone);
  const detail = `${m.format === "doubles" ? "Doubles" : "Singles"} · ${levelText(m.minRating, m.maxRating)}`;
  const where = [m.courtName ?? "Court not set", distanceLabel(miles), mine ? "You" : m.posterName].join(" · ");
  const mi = Math.max(1, Math.round(miles));
  return {
    id: m.id,
    when,
    detail,
    where,
    tags,
    need,
    miles,
    spoken: [
      when.replace(" · ", ", "),
      mine ? "your post" : null,
      tags.includes("youre_in") ? "you're in" : null,
      need ? `need ${need}` : null,
      detail.replace(" · ", ", ").toLowerCase(),
      m.courtName ?? "court not set",
      `about ${mi} mile${mi === 1 ? "" : "s"} away`,
      mine ? null : `posted by ${m.posterName}`,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

/** Open matches within `radius`, soonest first, with a count per distance chip. */
export function nearbyOpenMatches(viewer: string, myPoint: Point, rows: OpenMatchRow[], radius: number) {
  const cards = rows.map((m) => openMatchCard(viewer, myPoint, m));
  const steps = [...new Set<number>([...RADIUS_STEPS, radius])].sort((a, b) => a - b);
  const counts = steps.map((r) => ({ radius: r, count: cards.filter((c) => c.miles <= r).length }));
  const startOf = new Map(rows.map((r) => [r.id, r.startsAt.getTime()]));
  const matches = cards
    .filter((c) => c.miles <= radius)
    .sort((a, b) => startOf.get(a.id)! - startOf.get(b.id)! || a.id - b.id)
    .map(({ miles: _m, ...c }) => c);
  return { matches, counts };
}

/** Who gets an alert for a new post: alerts on, not the poster, near enough, level fits, under 2 today. */
export function alertRecipients(
  post: { poster: string; point: Point; minRating: number | null; maxRating: number | null },
  people: { clerkUserId: string; point: Point; radius: number; rating: number | null; sentToday: number }[],
): string[] {
  return people
    .filter(
      (p) =>
        p.clerkUserId !== post.poster &&
        p.sentToday < ALERTS_PER_DAY &&
        milesBetween(p.point, post.point) <= p.radius &&
        fitsRange(p.rating, post.minRating, post.maxRating),
    )
    .map((p) => p.clerkUserId);
}

/** "Sat 9 AM doubles": the group chat's name, on Home and in its header. */
export function chatTitle(m: Pick<OpenMatchRow, "startsAt" | "format" | "timeZone">): string {
  const day = m.startsAt.toLocaleDateString("en-US", { weekday: "short", timeZone: m.timeZone });
  const time = m.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: m.timeZone }).replace(":00", "");
  return `${day} ${time} ${m.format === "doubles" ? "doubles" : "singles"}`;
}

/** "Sat 9 AM doubles · Beacon Courts": the group chat in Messages and its pushes (F15). */
export function groupChatTitle(m: Pick<OpenMatchRow, "startsAt" | "format" | "timeZone" | "courtName">): string {
  return m.courtName ? `${chatTitle(m)} · ${m.courtName}` : chatTitle(m);
}
