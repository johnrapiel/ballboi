import type { BracketRound, BracketSlot, League, LeagueBracket, LeagueSchedule, ScheduleRound, Standing } from "@workspace/api-client-react";

import { areaLabel } from "./leagueArea";
import { addDays, dateRange, isMine, shortDate, weeklyMatchTime, type MyWeek } from "./leagueSchedule";
import { formatLabel, ordinal } from "./leagues";

// The league page as three tabs: Matches, Standings, Overview (Wave 3,
// decision 210, John's L1 to L10, Nov 14). Pure, so the words and the
// choices are tested in Node (lib/__tests__/leaguePage.test.ts).

export type LeagueTab = "matches" | "standings" | "overview";

/** The tabs, in order. Matches opens first, every time (L8). */
export const LEAGUE_TABS: { value: LeagueTab; label: string }[] = [
  { value: "matches", label: "Matches" },
  { value: "standings", label: "Standings" },
  { value: "overview", label: "Overview" },
];

/** iOS's accessibility text sizes start at AX1, a font scale of about 1.65. */
export const ACCESSIBILITY_TEXT_SCALE = 1.6;

/** True at the accessibility text sizes, where the standings table drops to place, name and record (L9). */
export function isAccessibilityTextSize(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale >= ACCESSIBILITY_TEXT_SCALE;
}

// ---------------------------------------------------------------------------
// Overview: About this league

type AboutLeague = Pick<
  League,
  "format" | "leagueType" | "partnerMode" | "location" | "area" | "startDate" | "endDate" | "seasonWeeks" | "playerCount" | "matchDay" | "matchTime" | "timeZone" | "status" | "endedAt"
>;

/** "Flex doubles, fixed partners", "Round robin singles". */
export function formatLine(league: Pick<League, "format" | "leagueType" | "partnerMode">): string {
  const doubles = league.leagueType === "doubles";
  const base = `${formatLabel(league.format)} ${doubles ? "doubles" : "singles"}`;
  if (!doubles) return base;
  if (league.partnerMode === "fixed") return `${base}, fixed partners`;
  if (league.partnerMode === "rotating") return `${base}, rotating partners`;
  return base;
}

/** "Robinson Lane courts, Wappingers Falls, NY": the usual courts, then the area. Null when neither is set. */
export function whereLine(league: Pick<League, "location" | "area">): string | null {
  const parts = [league.location?.trim() || null, areaLabel(league.area)].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : null;
}

/** Which week of the season `today` falls in, 1 to `weeks`; null before the start or without a length. */
export function seasonWeek(startDate: string | null | undefined, today: string | null | undefined, weeks: number | null | undefined): number | null {
  if (!startDate || !today || !weeks || weeks < 1) return null;
  if (today < startDate) return null;
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  return Math.min(weeks, Math.floor(days / 7) + 1);
}

/** "Oct 28 to Dec 22 · Week 3 of 8" while it runs; just the dates before the start and after the end. */
export function seasonLine(league: AboutLeague, today: string | null | undefined): string | null {
  if (!league.startDate) return null;
  // A league with a length but no end date ends `seasonWeeks` weeks after the start.
  const end = league.endDate ?? (league.seasonWeeks ? addDays(league.startDate, league.seasonWeeks * 7 - 1) : null);
  const dates = end ? dateRange(league.startDate, end) : `Starts ${shortDate(league.startDate)}`;
  const over = league.status === "completed" || !!league.endedAt;
  const week = over ? null : seasonWeek(league.startDate, today, league.seasonWeeks);
  return week && league.seasonWeeks ? `${dates} · Week ${week} of ${league.seasonWeeks}` : dates;
}

export interface AboutRow {
  label: string;
  value: string;
}

/** About this league, in order: Format, Matches, Where, Season, Players. Rows with nothing to say are left out. */
export function aboutRows(league: AboutLeague, today: string | null | undefined): AboutRow[] {
  const rows: (AboutRow | null)[] = [
    { label: "Format", value: formatLine(league) },
    (() => {
      const when = weeklyMatchTime(league.matchDay, league.matchTime, league.timeZone);
      return when ? { label: "Matches", value: when } : null;
    })(),
    (() => {
      const where = whereLine(league);
      return where ? { label: "Where", value: where } : null;
    })(),
    (() => {
      const season = seasonLine(league, today);
      return season ? { label: "Season", value: season } : null;
    })(),
    { label: "Players", value: String(league.playerCount) },
  ];
  return rows.filter((r): r is AboutRow => !!r);
}

// ---------------------------------------------------------------------------
// Standings: your summary (L1, L6)

type SummaryRow = Pick<Standing, "playerId" | "playerName" | "rank" | "wins" | "losses" | "teamId" | "teamPlayerIds">;

export interface StandingsSummary {
  /** "Your team" in fixed-partner doubles, else "You". */
  eyebrow: string;
  /** "2nd · 2–1", "No partner yet", or dashes before the start. */
  title: string;
  /** "With Maya Chen · 1 win behind Priya & Ben"; null when there's nothing to add. */
  line: string | null;
  /** What VoiceOver reads: "You, 2nd, 2 wins 1 loss". */
  spoken: string;
}

const winsWord = (n: number) => `${n} ${n === 1 ? "win" : "wins"}`;
const lossesWord = (n: number) => `${n} ${n === 1 ? "loss" : "losses"}`;
const spokenNames = (s: string) => s.replace(/ & /g, " and ");

/** Your row: the one with your player id, or the fixed-partner team you're on (D3). */
export function myStandingRow<T extends Pick<Standing, "playerId" | "teamPlayerIds">>(standings: readonly T[], myPlayerId: number | null | undefined): T | null {
  if (myPlayerId == null) return null;
  return standings.find((s) => s.playerId === myPlayerId) ?? standings.find((s) => !!s.teamPlayerIds?.includes(myPlayerId)) ?? null;
}

/**
 * The summary above the standings table. Fixed-partner doubles reads as your
 * team, with your partner; singles and rotating-partner doubles read as you
 * (L6). "1 win behind [name]" when behind first place; with first place
 * shared, "behind 1st place". Fixed-partner doubles with no partner yet:
 * "You · No partner yet" and no button, so Matches is the one place to act
 * (L1). Before the start, dashes, like the league cards (L3). Null when
 * you're not in the standings (an admin who doesn't play).
 */
export function standingsSummary({
  standings,
  myPlayerId,
  fixedPartners,
  partnerName,
  noPartner,
  started,
}: {
  standings: readonly SummaryRow[];
  myPlayerId: number | null | undefined;
  /** A fixed-partner doubles league: standings rank teams. */
  fixedPartners: boolean;
  /** Your partner's full name, fixed partners only. */
  partnerName: string | null | undefined;
  /** Fixed partners, a member, and no partner yet. */
  noPartner: boolean;
  started: boolean;
}): StandingsSummary | null {
  if (fixedPartners && noPartner) {
    return { eyebrow: "You", title: "No partner yet", line: null, spoken: "You, no partner yet" };
  }
  const mine = myStandingRow(standings, myPlayerId);
  if (!mine) return null;
  const team = fixedPartners && mine.teamId != null;
  const eyebrow = team ? "Your team" : "You";
  const withPartner = team && partnerName ? `With ${partnerName}` : null;

  if (!started) {
    return {
      eyebrow,
      title: "– · –",
      line: withPartner,
      spoken: [eyebrow, "not ranked yet", withPartner?.toLowerCase()].filter(Boolean).join(", "),
    };
  }

  const leaderWins = standings.reduce((max, s) => Math.max(max, s.wins), 0);
  const behind = leaderWins - mine.wins;
  const leaders = standings.filter((s) => s.wins === leaderWins);
  const behindLine = behind > 0 ? `${winsWord(behind)} behind ${leaders.length === 1 ? leaders[0].playerName : "1st place"}` : null;
  const line = [withPartner, behindLine].filter(Boolean).join(" · ") || null;
  const place = ordinal(mine.rank);
  return {
    eyebrow,
    title: `${place} · ${mine.wins}–${mine.losses}`,
    line,
    spoken: spokenNames(
      [`${eyebrow}, ${place}, ${winsWord(mine.wins)} ${lossesWord(mine.losses)}`, withPartner?.replace(/^With/, "with"), behindLine].filter(Boolean).join(", "),
    ),
  };
}

/** The line under the table: how ranks are decided, and who makes the playoffs. */
export function tiebreakLine(teams: boolean, playoffsNote: string | null | undefined): string {
  return `${teams ? "Teams ranked" : "Ranked"} by wins, then head to head.${playoffsNote ? ` ${playoffsNote}` : ""}`;
}

// ---------------------------------------------------------------------------
// Matches: which round is "this round", and what goes under it

const outRounds = (schedule: Pick<LeagueSchedule, "rounds"> | undefined) =>
  (schedule?.rounds ?? []).filter((r) => r.phase !== "draft").slice().sort((a, b) => a.roundNumber - b.roundNumber);

/**
 * This round: the one your match or bye is in (myWeek), else the round that's
 * open, else the latest one that has started, else the first one paired.
 */
export function currentRound(schedule: Pick<LeagueSchedule, "rounds"> | undefined, week: MyWeek | null): ScheduleRound | null {
  if (week) return week.round;
  const rounds = outRounds(schedule);
  return (
    rounds.find((r) => r.phase === "open") ??
    rounds.filter((r) => r.phase !== "upcoming").pop() ??
    rounds[0] ??
    null
  );
}

export interface MatchSections {
  /** This round without your match or your bye; null when nothing else is in it. */
  others: ScheduleRound | null;
  /** Rounds already paired after this one, soonest first. */
  next: ScheduleRound[];
  /** Rounds before this one, newest first. */
  earlier: ScheduleRound[];
}

/** What sits under the top spot on Matches: Other matches this round, then Earlier rounds. */
export function matchSections(
  schedule: Pick<LeagueSchedule, "rounds"> | undefined,
  current: ScheduleRound | null,
  myPlayerId: number | null | undefined,
): MatchSections {
  const rounds = outRounds(schedule);
  if (!current) return { others: null, next: [], earlier: rounds.slice().reverse() };
  const matches = current.matches.filter((m) => !isMine(m, myPlayerId));
  const byes = current.byes.filter((b) => b.playerId !== myPlayerId);
  return {
    others: matches.length || byes.length ? { ...current, matches, byes } : null,
    next: rounds.filter((r) => r.roundNumber > current.roundNumber),
    earlier: rounds.filter((r) => r.roundNumber < current.roundNumber).reverse(),
  };
}

/** The start date of the round after `current`: a paired round, else the next week on the calendar. */
export function nextRoundStart(schedule: Pick<LeagueSchedule, "rounds" | "upcoming"> | undefined, current: Pick<ScheduleRound, "roundNumber"> | null): string | null {
  if (!schedule) return null;
  const after = outRounds(schedule).find((r) => current == null || r.roundNumber > current.roundNumber);
  return after?.startDate ?? schedule.upcoming[0]?.startDate ?? null;
}

/** "Your next round goes out Tue, Nov 18", or null when there's no round after this one. */
export function byeLine(nextStart: string | null): string | null {
  return nextStart ? `Your next round goes out ${shortDate(nextStart)}` : null;
}

/**
 * Your most recent regular-season match, for the top spot when there's no
 * round to act on (knocked out of the playoffs, or not seeded).
 */
export function lastRegularMatch(schedule: Pick<LeagueSchedule, "rounds"> | undefined, myPlayerId: number | null | undefined): MyWeek | null {
  if (myPlayerId == null) return null;
  const rounds = outRounds(schedule).reverse();
  for (const round of rounds) {
    const match = round.matches.find((m) => isMine(m, myPlayerId) && !m.voided);
    if (match) return { round, match, bye: false };
  }
  return null;
}

/** Your latest finished playoff match: the top spot once you're knocked out, or after the final. */
export function lastPlayoffMatch(bracket: Pick<LeagueBracket, "rounds"> | null | undefined, myPlayerId: number | null | undefined): { slot: BracketSlot; round: BracketRound } | null {
  if (!bracket || myPlayerId == null) return null;
  for (const round of bracket.rounds.slice().reverse()) {
    const slot = round.slots.find((s) => (s.player1?.playerId === myPlayerId || s.player2?.playerId === myPlayerId) && s.status === "completed");
    if (slot) return { slot, round };
  }
  return null;
}

/** The section over earlier rounds: "Regular season" once playoffs are on (L2). */
export function earlierHeading(playoffs: boolean): string {
  return playoffs ? "Regular season" : "Earlier rounds";
}

/** The empty state before the start (L3): "Starts Thu, Nov 20" and when the first match shows. */
export function notStartedText(startDate: string | null | undefined): { title: string; message: string } {
  return {
    title: startDate ? `Starts ${shortDate(startDate)}` : "Not started yet",
    message: "Your first match shows here when round 1 goes out.",
  };
}
