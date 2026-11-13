import type { LeagueWeek, LeagueWeekItem, LeagueWeekPlayoff } from "@workspace/api-client-react";
import { versusLine, versusSpoken } from "./doubles";

import { deadlineDate, isToday, lateTime } from "./leagueSchedule";
import { isPastDue, pastDueSpoken, pastDueWhen } from "./matchTiming";
import { clockTime } from "./timeFormat";

// Upcoming matches (spec decision 137, John, Nov 8): one list of every match
// still to play, league, playoff and Discover, in date order. Home shows the
// first as the D2 card and the rest as rows; Profile's Upcoming matches tab
// uses the same rows. Pure, so it's tested in lib/__tests__.

/** A match card added in a Discover chat (GET /match-plans/upcoming). */
export interface PlanInput {
  id: number;
  startsAt: string;
  courtName: string | null;
  kind: "singles" | "practice";
  matchId: number | null;
  score: string | null;
  otherName: string;
  otherUserId: number | null;
  /** Their photo; older servers don't send it. */
  otherAvatarUrl?: string | null;
}

/** An open match you posted or hold a spot in (GET /open-matches/mine). */
export interface OpenInput {
  id: number;
  /** Older servers don't send it; those posts sort last. */
  startsAt?: string | null;
  format: string;
  courtName: string | null;
  status: string;
  spotsLeft: number;
}

export type UpcomingKind = "league" | "playoff" | "discover" | "open";

export interface UpcomingItem {
  key: string;
  kind: UpcomingKind;
  /** The set time, when there is one. */
  scheduledAt: string | null;
  /** "Sun, Nov 15" (plus the league's zone when it isn't yours): the play-by date when no time is set. */
  playBy: string | null;
  /** For a league round that hasn't started: "Mon, Nov 9". */
  starts: string | null;
  /** Null for an open match, which has no single opponent. */
  opponentName: string | null;
  /** League matches: the opponent's player id, for Message. */
  opponentPlayerId: number | null;
  /** Doubles league matches (D8): your partner, for "You and Sam vs. Jo and Lee". */
  partnerName: string | null;
  /** Doubles league matches: the other team's names. Empty otherwise. */
  opponentNames: string[];
  /** The singles opponent's photo ("/objects/..."), for the next-match card. */
  opponentPhoto: string | null;
  /** Discover matches: the other player's user id, for their chat. */
  otherUserId: number | null;
  leagueId: number | null;
  /** "Tuesday Flex 3.5", "Tuesday Flex 3.5 · Semifinal", "Discover" or "Open match". */
  context: string;
  matchId: number | null;
  location: string | null;
  singles: boolean;
  /** A late match: its round's week has passed and it's in its extra week (decision 152). */
  grace: boolean;
  /** League round still to open. */
  notStarted: boolean;
  openMatchId: number | null;
  /** "2 spots left", "Full": open matches only. */
  openStatus: string | null;
  /** The sort key: the set time, else the end of the play-by day. */
  sortAt: string;
  /** League and playoff matches: the league's time zone, for "Earlier today" (finding 47). Null uses the phone's. */
  timeZone?: string | null;
}

const endOfDay = (date: string) => `${date}T23:59:59`;

function isoOk(iso: string | null | undefined): iso is string {
  return !!iso && !Number.isNaN(new Date(iso).getTime());
}

/** Sort key that compares across ISO times and YYYY-MM-DD play-by dates. */
function sortKey(scheduledAt: string | null, playByDate: string | null): string {
  if (isoOk(scheduledAt)) return new Date(scheduledAt).toISOString();
  return playByDate ? new Date(endOfDay(playByDate)).toISOString() : "9999-12-31T23:59:59.000Z";
}

/**
 * Every match still to play, soonest first. Byes, played matches, playoff
 * matches past their play-by date, scored Discover matches and cancelled
 * open matches aren't matches to play. `stage` names a playoff round
 * ("Semifinal").
 */
export function upcomingList(input: {
  week?: Pick<LeagueWeek, "thisWeek" | "playoffs"> | null;
  plans?: PlanInput[] | null;
  open?: OpenInput[] | null;
  stage?: (round: string) => string;
  now?: Date;
}): UpcomingItem[] {
  const now = input.now ?? new Date();
  const stage = input.stage ?? (() => "Playoffs");
  const base = {
    opponentPlayerId: null,
    partnerName: null,
    opponentNames: [] as string[],
    opponentPhoto: null,
    otherUserId: null,
    leagueId: null,
    matchId: null,
    location: null,
    singles: true,
    grace: false,
    notStarted: false,
    openMatchId: null,
    openStatus: null,
    playBy: null,
    starts: null,
  };
  const weekly: UpcomingItem[] = (input.week?.thisWeek ?? [])
    .filter((i): i is LeagueWeekItem & { matchId: number } => !i.bye && i.matchId != null && !i.played)
    .map((i) => {
      const late = i.phase === "grace";
      const playByDate = late ? i.graceEnd : i.deadline;
      // A late match keeps its saved time only while it's still ahead; a past
      // time would read as upcoming, so it shows "Play by" instead (decision 152).
      const scheduledAt = isoOk(i.scheduledAt) ? (late ? lateTime(i.scheduledAt, now) : i.scheduledAt) : null;
      return {
        ...base,
        key: `m-${i.matchId}`,
        kind: "league",
        scheduledAt,
        playBy: deadlineDate(playByDate, i.timeZone),
        starts: i.phase === "upcoming" ? deadlineDate(i.startDate, null) : null,
        opponentName: i.opponentName ?? "your opponent",
        opponentPlayerId: i.opponentPlayerId,
        partnerName: i.partnerName ?? null,
        opponentNames: i.opponentNames ?? [],
        opponentPhoto: i.opponentAvatarUrl ?? null,
        leagueId: i.leagueId,
        context: i.leagueName,
        matchId: i.matchId,
        location: i.location,
        singles: i.singles,
        grace: late,
        notStarted: i.phase === "upcoming",
        sortAt: sortKey(scheduledAt, playByDate),
        timeZone: i.timeZone ?? null,
      };
    });
  const playoffs: UpcomingItem[] = (input.week?.playoffs ?? [])
    .filter((p: LeagueWeekPlayoff) => !p.pastPlayBy)
    .map((p) => ({
      ...base,
      key: `po-${p.matchId}`,
      kind: "playoff",
      scheduledAt: isoOk(p.scheduledAt) ? p.scheduledAt : null,
      playBy: p.playBy ? deadlineDate(p.playBy, p.timeZone) : null,
      opponentName: p.opponentName,
      opponentPlayerId: p.opponentPlayerId,
      opponentPhoto: p.opponentAvatarUrl ?? null,
      leagueId: p.leagueId,
      context: `${p.leagueName} · ${stage(p.round)}`,
      matchId: p.matchId,
      location: p.location,
      singles: p.singles,
      sortAt: sortKey(p.scheduledAt, p.playBy),
      timeZone: p.timeZone ?? null,
    }));
  const plans: UpcomingItem[] = (input.plans ?? [])
    .filter((p) => !p.score && isoOk(p.startsAt))
    .map((p) => ({
      ...base,
      key: `plan-${p.id}`,
      kind: "discover",
      scheduledAt: p.startsAt,
      opponentName: p.otherName,
      otherUserId: p.otherUserId,
      opponentPhoto: p.otherAvatarUrl ?? null,
      context: "Discover",
      matchId: p.matchId,
      location: p.courtName,
      singles: p.kind === "singles",
      sortAt: sortKey(p.startsAt, null),
    }));
  const open: UpcomingItem[] = (input.open ?? [])
    .filter((o) => o.status !== "canceled" && o.status !== "cancelled")
    .map((o) => ({
      ...base,
      key: `open-${o.id}`,
      kind: "open",
      scheduledAt: isoOk(o.startsAt) ? o.startsAt : null,
      opponentName: null,
      context: "Open match",
      location: o.courtName,
      singles: o.format !== "doubles",
      openMatchId: o.id,
      openStatus: o.status === "full" ? "Full" : `${o.spotsLeft} ${o.spotsLeft === 1 ? "spot" : "spots"} left`,
      sortAt: sortKey(o.startsAt ?? null, null),
    }));
  return [...weekly, ...playoffs, ...plans, ...open].sort((a, b) => a.sortAt.localeCompare(b.sortAt) || a.key.localeCompare(b.key));
}

const dayShort = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayLong = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const clock = clockTime;
/** "9 AM" or "6:30 PM", as VoiceOver says a time. */
const clockSpoken = clockTime;

/**
 * A row's top line: "Sat, Nov 14 · 9 AM", "Today · 6:30 PM", "Earlier today ·
 * 6:30 PM" an hour after the start with no score (finding 47), or
 * "Play by Sun, Nov 15" when no time is set.
 */
export function rowWhen(m: Pick<UpcomingItem, "scheduledAt" | "playBy" | "starts"> & { timeZone?: string | null }, now: Date = new Date()): string {
  if (m.scheduledAt && isPastDue(m, now)) return pastDueWhen(m.scheduledAt);
  if (m.scheduledAt) {
    const d = new Date(m.scheduledAt);
    return `${isToday(m.scheduledAt, now) ? "Today" : dayShort(d)} · ${clock(d)}`;
  }
  if (m.starts) return `Starts ${m.starts}`;
  return m.playBy ? `Play by ${m.playBy}` : "No time set yet";
}

/** A row's second line: "vs. Priya Shah · Discover", or "Open match · Doubles · 2 spots left". */
export function rowSub(
  m: Pick<UpcomingItem, "kind" | "opponentName" | "context" | "singles" | "openStatus"> & Partial<Pick<UpcomingItem, "partnerName" | "opponentNames">>,
): string {
  if (m.kind === "open") return ["Open match", m.singles ? "Singles" : "Doubles", m.openStatus].filter(Boolean).join(" · ");
  // D8: "You and Sam vs. Jo and Lee · Thursday Doubles".
  if (m.partnerName && m.opponentNames?.length) return `${versusLine(m.partnerName, m.opponentNames)} · ${m.context}`;
  return `vs. ${m.opponentName} · ${m.context}`;
}

/** The row as VoiceOver reads it, with words in place of dots and short days. */
export function rowSpoken(
  m: Pick<UpcomingItem, "kind" | "scheduledAt" | "playBy" | "starts" | "opponentName" | "context" | "singles" | "openStatus" | "location"> &
    Partial<Pick<UpcomingItem, "partnerName" | "opponentNames">> & { grace?: boolean; timeZone?: string | null },
  now: Date = new Date(),
): string {
  let when: string;
  if (m.scheduledAt && isPastDue(m, now)) {
    when = pastDueSpoken(m.scheduledAt);
  } else if (m.scheduledAt) {
    const d = new Date(m.scheduledAt);
    when = `${m.grace ? "Late match, " : ""}${isToday(m.scheduledAt, now) ? "Today" : dayLong(d)}, ${clockSpoken(d)}`;
  } else if (m.starts) {
    when = `No time set yet, round starts ${m.starts}`;
  } else {
    when = m.playBy ? `${m.grace ? "Late match" : "No time set yet"}, play by ${m.playBy}` : "No time set yet";
  }
  const who =
    m.kind === "open"
      ? `Open match, ${m.singles ? "singles" : "doubles"}${m.openStatus ? `, ${m.openStatus.toLowerCase()}` : ""}`
      : m.partnerName && m.opponentNames?.length
        ? `${versusSpoken(m.partnerName, m.opponentNames)}${m.location ? ` at ${m.location}` : ""}`
        : `Versus ${m.opponentName}${m.location ? ` at ${m.location}` : ""}`;
  const context = m.kind === "open" ? null : m.kind === "discover" ? "Set up in Discover" : m.context.replace(/ · /g, ", ");
  return [when, who, context].filter(Boolean).join(". ");
}

/**
 * Match day for the D2 card: a set time today. Only then does a singles
 * match lead with Record with Ball Boi (John, Nov 8).
 */
export function isMatchDay(m: Pick<UpcomingItem, "scheduledAt">, now: Date = new Date()): boolean {
  return !!m.scheduledAt && isToday(m.scheduledAt, now);
}

/**
 * The D2 card's date line and big serif line. A late match with no time
 * ahead reads "Late match" over "Play by Fri, Nov 13" (decision 152).
 */
export function cardWhen(
  m: Pick<UpcomingItem, "scheduledAt" | "playBy" | "starts"> & { grace?: boolean; timeZone?: string | null },
  now: Date = new Date(),
): { dateLabel: string; time: string } {
  // An hour past the start with no score (finding 47).
  if (m.scheduledAt && isPastDue(m, now)) return { dateLabel: "Earlier today", time: clock(new Date(m.scheduledAt)) };
  if (m.scheduledAt) {
    const d = new Date(m.scheduledAt);
    return {
      dateLabel: isToday(m.scheduledAt, now) ? "Today" : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      time: clock(d),
    };
  }
  if (m.grace && m.playBy) return { dateLabel: "Late match", time: `Play by ${m.playBy}` };
  return { dateLabel: m.starts ? `Starts ${m.starts}` : "No time set yet", time: m.playBy ? `By ${m.playBy}` : "Time to be set" };
}
