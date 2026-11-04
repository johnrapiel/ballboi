import type { League } from "@workspace/api-client-react";

/** Plain-English label for a league's format. */
export function formatLabel(format: League["format"]): string {
  switch (format) {
    case "flex":
      return "Flex";
    case "round_robin":
      return "Round robin";
    case "swiss":
      return "Swiss";
    case "elimination":
      return "Elimination";
    default:
      return format;
  }
}

/** Singles or doubles, from the league's type. */
export function playTypeLabel(leagueType: League["leagueType"]): string {
  return leagueType === "doubles" ? "Doubles" : "Singles";
}

/** Chip text for a league's status. */
export function statusLabel(status: League["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "upcoming":
      return "Starts soon";
    case "completed":
      return "Done";
    default:
      return status;
  }
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "8 players", "1 player". */
export function playersLabel(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

/**
 * Past on the Leagues tab: finished, ended, or a league you left as a player
 * (C5). An admin who left still runs it, so it stays under Current.
 */
export function isPastLeague(league: Pick<League, "status" | "endedAt" | "youLeft">): boolean {
  return league.status === "completed" || !!league.endedAt || !!league.youLeft;
}

/** The chip on a Past row: "Left", "Ended" or "Done". */
export function pastLabel(league: Pick<League, "endedAt" | "youLeft">): string {
  return league.youLeft ? "Left" : league.endedAt ? "Ended" : "Done";
}
