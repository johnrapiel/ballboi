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

/** "Fixed partners" or "Rotating partners" for a doubles league; null otherwise. */
export function partnerLabel(league: Pick<League, "leagueType" | "partnerMode">): string | null {
  if (league.leagueType !== "doubles") return null;
  if (league.partnerMode === "fixed") return "Fixed partners";
  if (league.partnerMode === "rotating") return "Rotating partners";
  return null;
}

/** A league that hasn't started yet (the server keeps status in step with the start date). */
export function notStarted(league: Pick<League, "status">): boolean {
  return league.status === "upcoming";
}

/** "Nov 18" for a "YYYY-MM-DD" start date, or null if it doesn't read. */
export function startDay(startDate: string | null | undefined, month: "short" | "long" = "short"): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(startDate)) return null;
  const d = new Date(`${startDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString("en-US", { month, timeZone: "UTC" })} ${d.getUTCDate()}`;
}

/**
 * The Leagues tab card's words (finding 27, decision 183). The pill says
 * Singles or Doubles; a running league has no status. A league that hasn't
 * started leads its info line with "Starts Nov 18" (next to a calendar icon)
 * and has no stats row. VoiceOver hears one sentence:
 * "Beta Testers, Singles, starts November 18, 3 players, round robin".
 */
export function leagueCardText(
  league: Pick<League, "name" | "status" | "leagueType" | "partnerMode" | "startDate" | "playerCount" | "format">,
  place: string | null | undefined,
): { pill: string; starts: string | null; info: string; spoken: string; showStats: boolean } {
  const pill = playTypeLabel(league.leagueType);
  const upcoming = notStarted(league);
  const day = startDay(league.startDate);
  const starts = upcoming ? (day ? `Starts ${day}` : "Not started") : null;
  const rest = [place || null, playersLabel(league.playerCount), partnerLabel(league), formatLabel(league.format)].filter(
    (x): x is string => !!x,
  );
  const info = [starts, ...rest].filter(Boolean).join(" · ");
  const spokenStart = upcoming ? (day ? `starts ${startDay(league.startDate, "long")}` : "not started") : null;
  const spoken = [league.name, pill, spokenStart, ...rest.map((x, i) => (i === 0 && x === place ? x : x.toLowerCase()))]
    .filter(Boolean)
    .join(", ");
  return { pill, starts, info, spoken, showStats: !upcoming };
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
