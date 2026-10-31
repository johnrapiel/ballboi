import type { LeagueSchedule, ScheduleMatch, ScheduleRound } from "@workspace/api-client-react";

// Helpers for the league schedule (spec: Leagues > Weekly loop, Scores and
// standings). Dates are YYYY-MM-DD in the league's time zone.

/** "Thu, Nov 5" */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

export function opponentName(m: ScheduleMatch, myPlayerId: number): string {
  return m.player1Id === myPlayerId ? m.player2Name : m.player1Name;
}

export function isMine(m: ScheduleMatch, myPlayerId: number | null | undefined): boolean {
  return myPlayerId != null && (m.player1Id === myPlayerId || m.player2Id === myPlayerId);
}

/** A stored score (player 1's side) as the given player sees it: their games first. */
export function scoreForPlayer(score: string, m: Pick<ScheduleMatch, "player1Id">, playerId: number): string {
  if (m.player1Id === playerId) return score;
  return score
    .split(",")
    .map((set) => {
      const x = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return x ? `${x[2]}-${x[1]}${x[3] ?? ""}` : set.trim();
    })
    .join(", ");
}

/** "Alex Kim won 6-3, 6-4" from the winner's side, or a status in words. */
export function resultLine(m: ScheduleMatch): string {
  if (m.voided) return "Cancelled";
  if (m.status !== "completed" || !m.score || m.winnerId == null) return "Not played yet";
  const winner = m.winnerId === m.player1Id ? m.player1Name : m.player2Name;
  return `${winner} won ${scoreForPlayer(m.score, m, m.winnerId)}`;
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

/** Whether a match can be scored now: it's out, unplayed, not voided, and not past its grace week. */
export function canEnterScore(round: ScheduleRound, m: ScheduleMatch): boolean {
  return (round.phase === "open" || round.phase === "grace") && m.status !== "completed" && !m.voided;
}
