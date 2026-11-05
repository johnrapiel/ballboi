import type { LeagueSchedule, ScheduleMatch, ScheduleRound } from "@workspace/api-client-react";

import { flipScore, WALKOVER_SCORE } from "./tennisScore";

// Helpers for the league schedule (spec: Leagues > Weekly loop, Scores and
// standings). Dates are YYYY-MM-DD in the league's time zone.

/** A YYYY-MM-DD date moved by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Thu, Nov 5" */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The phone's own time zone, like "America/Los_Angeles". */
export function phoneTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Leagues run on their creator's time zone (PR 4). When that isn't the
 * viewer's, a deadline names it: " PST", " ET". Empty when it's the same.
 */
export function zoneSuffix(timeZone: string | null | undefined, at: Date = new Date()): string {
  if (!timeZone) return "";
  const mine = phoneTimeZone();
  if (!mine || mine === timeZone) return "";
  const name = (tz: string) => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")
          ?.value ?? ""
      );
    } catch {
      return "";
    }
  };
  const theirs = name(timeZone);
  // Same clock under another name (New York and Toronto): nothing to say.
  if (!theirs || theirs === name(mine)) return "";
  return ` ${theirs}`;
}

/** "Thu, Nov 5" plus the league's time zone when it isn't the viewer's. */
export function deadlineDate(date: string, timeZone: string | null | undefined): string {
  return `${shortDate(date)}${zoneSuffix(timeZone)}`;
}

/** "7am" plus the league's time zone when it isn't the viewer's: when pairings go out. */
export function pairingTime(timeZone: string | null | undefined): string {
  return `7am${zoneSuffix(timeZone)}`;
}

/** True when an ISO time falls on the phone's today. */
export function isToday(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString();
}

/** "Today at 6:00 PM" or "Thu, Nov 5 at 6:00 PM", on the phone's clock. */
export function matchWhen(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isToday(iso, now)) return `Today at ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Tuesdays at 6:30 PM" for a league's weekly match day and "HH:MM" time, or null. */
export function weeklyMatchTime(matchDay: number | null | undefined, matchTime: string | null | undefined, timeZone?: string | null): string | null {
  if (matchDay == null || !matchTime) return null;
  const [h, m] = matchTime.split(":").map(Number);
  const clock = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${DAYS[matchDay]}s at ${clock}${zoneSuffix(timeZone)}`;
}

/** The instant when the clock in `timeZone` reads `date` (YYYY-MM-DD) at `time` (HH:MM). Mirrors the API's leagueCalendar. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (at: number) => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(new Date(at));
      const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute")) - Math.floor(at / 60000) * 60000;
    } catch {
      return -new Date(at).getTimezoneOffset() * 60000;
    }
  };
  let at = wall - offsetAt(wall);
  at = wall - offsetAt(at);
  return new Date(at);
}

/** "Nov 5 to 11" or "Nov 26 to Dec 2" */
export function dateRange(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  return `${month(s)} ${s.getUTCDate()} to ${sameMonth ? "" : `${month(e)} `}${e.getUTCDate()}`;
}

/** Short status for a round, always in words (never color alone). */
export function phaseLabel(phase: ScheduleRound["phase"]): string {
  switch (phase) {
    case "draft":
      return "Draft";
    case "upcoming":
      return "Next";
    case "open":
      return "This week";
    case "grace":
      return "Grace week";
    case "closed":
      return "Done";
    default:
      return phase;
  }
}

// Doubles (Wave 2): side 1 is player 1 and player 3, side 2 is player 2 and
// player 4. Singles matches have no player 3 or 4.

type Sides = Pick<ScheduleMatch, "player1Id" | "player1Name" | "player2Id" | "player2Name"> &
  Partial<Pick<ScheduleMatch, "player3Id" | "player3Name" | "player4Id" | "player4Name">>;
type SideIds = Pick<ScheduleMatch, "player1Id"> & Partial<Pick<ScheduleMatch, "player2Id" | "player3Id" | "player4Id">>;

export function isDoublesMatch(m: Partial<Pick<ScheduleMatch, "player3Id" | "player4Id">>): boolean {
  return m.player3Id != null && m.player4Id != null;
}

/** 1 for player 1's side, 2 for player 2's, null when the player isn't in the match. */
export function sideOf(m: SideIds, playerId: number | null | undefined): 1 | 2 | null {
  if (playerId == null) return null;
  if (m.player1Id === playerId || m.player3Id === playerId) return 1;
  if (m.player2Id === playerId || m.player4Id === playerId) return 2;
  return null;
}

/** "Alex Kim", or "Alex Kim and Sam Lee" in doubles. */
export function sideName(m: Sides, side: 1 | 2): string {
  const names = side === 1 ? [m.player1Name, m.player3Name] : [m.player2Name, m.player4Name];
  return names.filter((n): n is string => !!n).join(" and ");
}

/** "Alex Kim vs. Jo Park", or "Alex Kim and Sam Lee vs. Jo Park and Lee Chen". */
export function matchTitle(m: Sides): string {
  return `${sideName(m, 1)} vs. ${sideName(m, 2)}`;
}

/** The other side, as one name: your opponent, or your two opponents in doubles. */
export function opponentName(m: Sides, myPlayerId: number): string {
  return sideName(m, sideOf(m, myPlayerId) === 2 ? 1 : 2);
}

/** Your doubles partner, or null in singles. */
export function partnerOf(m: Sides, myPlayerId: number): { playerId: number; name: string } | null {
  if (m.player3Id == null || m.player4Id == null) return null;
  const pairs: [number, number, string | null | undefined][] = [
    [m.player1Id, m.player3Id, m.player3Name],
    [m.player3Id, m.player1Id, m.player1Name],
    [m.player2Id, m.player4Id, m.player4Name],
    [m.player4Id, m.player2Id, m.player2Name],
  ];
  const found = pairs.find(([me]) => me === myPlayerId);
  return found ? { playerId: found[1], name: found[2] ?? "Your partner" } : null;
}

/** "Alex" from "Alex Kim", or "Alex and Sam" from "Alex Kim and Sam Lee". */
export function firstNames(name: string): string {
  return name
    .split(" and ")
    .map((n) => n.trim().split(" ")[0])
    .join(" and ");
}

/** Everyone in a match, side 1 first: two players, or four in doubles. */
export function matchPlayers(m: Sides): { playerId: number; name: string }[] {
  const slots: [number | null | undefined, string | null | undefined][] = [
    [m.player1Id, m.player1Name],
    [m.player3Id, m.player3Name],
    [m.player2Id, m.player2Name],
    [m.player4Id, m.player4Name],
  ];
  return slots.flatMap(([playerId, name]) => (playerId == null ? [] : [{ playerId, name: name ?? "Player" }]));
}

export function isMine(m: Sides, myPlayerId: number | null | undefined): boolean {
  return sideOf(m, myPlayerId) != null;
}

/** A stored score (player 1's side) as the given player sees it: their games first. RET and W/O stay. */
export function scoreForPlayer(score: string, m: SideIds, playerId: number): string {
  return sideOf(m, playerId) === 1 ? score : flipScore(score);
}

/** "6-3, 6-4" from the winner's side, or "by W/O" for a walkover (C18, Q5). */
export function winningScore(score: string, m: SideIds, winnerId: number): string {
  return score.trim() === WALKOVER_SCORE ? `by ${WALKOVER_SCORE}` : scoreForPlayer(score, m, winnerId);
}

/**
 * C6: an unplayed match whose grace week has passed, or any unplayed match
 * once the league has ended (C24). It shows "Not played" and has no effect
 * on standings.
 */
export function isNotPlayed(round: Pick<ScheduleRound, "phase">, m: ScheduleMatch, ended = false): boolean {
  return (ended || round.phase === "closed") && !m.voided && m.status !== "completed";
}

/** "Alex Kim won 6-3, 6-4" from the winner's side, or a status in words. */
export function resultLine(m: ScheduleMatch, round?: Pick<ScheduleRound, "phase">, ended = false): string {
  if (m.voided) return "Cancelled";
  if (round && isNotPlayed(round, m, ended)) return "Not played";
  if (m.status !== "completed" || !m.score || m.winnerId == null) return ended ? "Not played" : "Not played yet";
  // Doubles store the winning side by its first player (player 1 or player 2).
  const winner = sideName(m, sideOf(m, m.winnerId) === 2 ? 2 : 1);
  return `${winner} won ${winningScore(m.score, m, m.winnerId)}`;
}

export interface MyWeek {
  round: ScheduleRound;
  match: ScheduleMatch | null;
  bye: boolean;
}

/**
 * The round the player should act on: this week's, else a grace-week match
 * still waiting for a score, else next week's.
 */
export function myWeek(schedule: LeagueSchedule | undefined, myPlayerId: number | null | undefined): MyWeek | null {
  if (!schedule || myPlayerId == null) return null;
  const out = schedule.rounds.filter((r) => r.phase !== "draft");
  const find = (r: ScheduleRound): MyWeek | null => {
    const match = r.matches.find((m) => isMine(m, myPlayerId) && !m.voided) ?? null;
    const bye = r.byes.some((b) => b.playerId === myPlayerId);
    return match || bye ? { round: r, match, bye } : null;
  };
  const graceOpen = out.find((r) => r.phase === "grace" && r.matches.some((m) => isMine(m, myPlayerId) && !m.voided && m.status !== "completed"));
  const current = out.find((r) => r.phase === "open");
  const next = out.find((r) => r.phase === "upcoming");
  for (const r of [current, graceOpen, next]) {
    if (!r) continue;
    const week = find(r);
    if (week) return week;
  }
  return null;
}

/** Whether a match can be scored now: it's out, unplayed, not voided, not past its grace week, and the league is still on. */
export function canEnterScore(round: ScheduleRound, m: ScheduleMatch, ended = false): boolean {
  return !ended && (round.phase === "open" || round.phase === "grace") && m.status !== "completed" && !m.voided;
}

/** C21: the playoff line under the standings, or null with no playoffs. */
export function playoffLine(playoffSize: number | null | undefined, activePlayers: number): string | null {
  if (!playoffSize) return null;
  if (activePlayers < 4) return "Not enough players for playoffs this season.";
  return `Top ${activePlayers >= 8 && playoffSize >= 8 ? 8 : 4} make the playoffs.`;
}

/** C5: "Corrected by Sam Lee on Nov 6", shown to both players and in Manage. */
export function correctionLine(m: Pick<ScheduleMatch, "correctedBy" | "correctedAt">): string | null {
  if (!m.correctedBy || !m.correctedAt) return null;
  const on = new Date(m.correctedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Corrected by ${m.correctedBy} on ${on}`;
}

/** C4: seconds left to undo a score you entered, or 0 once it stands. */
export function undoSecondsLeft(undoUntil: string | null | undefined, now: number): number {
  if (!undoUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 1000));
}

/** "9:41" */
export function countdownLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "9 minutes 41 seconds", for VoiceOver. */
export function countdownSpoken(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const parts = [m ? `${m} ${m === 1 ? "minute" : "minutes"}` : null, s || !m ? `${s} ${s === 1 ? "second" : "seconds"}` : null];
  return parts.filter(Boolean).join(" ");
}
