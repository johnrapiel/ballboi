// Doubles in the app (doubles flow review, John, Nov 9: D1 to D9). Pure, so
// the words are tested in Node (lib/__tests__/doubles.test.ts).
//
// A doubles match is player1 + player3 against player2 + player4. Names on
// screen use first names ("You and Sam vs. Jo and Lee", D8); VoiceOver hears
// full names ("You and Sam Lee versus Jo Park and Lee King").

export type Partners = "fixed" | "rotating";

/** One line under the Partners choice in Start a league (D1). */
export const PARTNERS_HINT: Record<Partners, string> = {
  fixed: "Fixed partners: players team up when they join and keep that partner all season.",
  rotating: "Rotating partners: each week we make new teams by level, so you partner someone new.",
};

export interface FourPlayers {
  player1Id: number;
  player1Name: string;
  player2Id: number;
  player2Name: string;
  player3Id?: number | null;
  player3Name?: string | null;
  player4Id?: number | null;
  player4Name?: string | null;
}

export function isDoublesMatch(m: Pick<FourPlayers, "player3Id" | "player4Id">): boolean {
  return m.player3Id != null && m.player4Id != null;
}

/** "Sam" from "Sam Lee". */
export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] || "Player";
}

/** "Sam L." from "Sam Lee". */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "Player";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "Jo and Lee", "Ana, Bo and Cy" */
export function andJoin(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The side a player is on, or null when they aren't in the match. */
export function sideOf(m: FourPlayers, playerId: number | null | undefined): 1 | 2 | null {
  if (playerId == null) return null;
  if (m.player1Id === playerId || m.player3Id === playerId) return 1;
  if (m.player2Id === playerId || m.player4Id === playerId) return 2;
  return null;
}

/** Names on one side, in order. */
export function sideNames(m: FourPlayers, side: 1 | 2): string[] {
  const names = side === 1 ? [m.player1Name, m.player3Name] : [m.player2Name, m.player4Name];
  return names.filter((n): n is string => !!n);
}

/** Your partner's name in a doubles match; null in singles or when you're not in it. */
export function partnerName(m: FourPlayers, playerId: number | null | undefined): string | null {
  const side = sideOf(m, playerId);
  if (side == null || !isDoublesMatch(m)) return null;
  const pairs: [number | null | undefined, string | null | undefined][] =
    side === 1 ? [[m.player1Id, m.player1Name], [m.player3Id, m.player3Name]] : [[m.player2Id, m.player2Name], [m.player4Id, m.player4Name]];
  return pairs.find(([id]) => id !== playerId)?.[1] ?? null;
}

/** The other side's names, from your side. */
export function opponentNames(m: FourPlayers, playerId: number | null | undefined): string[] {
  const side = sideOf(m, playerId);
  return sideNames(m, side === 2 ? 1 : 2);
}

/** "You and Sam vs. Jo and Lee" (D8). Singles: "You vs. Jo Park". */
export function versusLine(partner: string | null | undefined, opponents: string[]): string {
  if (!partner && opponents.length <= 1) return `You vs. ${opponents[0] ?? "Player"}`;
  const us = partner ? `You and ${firstName(partner)}` : "You";
  return `${us} vs. ${andJoin(opponents.map(firstName))}`;
}

/** VoiceOver: team names read in full. "You and Sam Lee versus Jo Park and Lee King". */
export function versusSpoken(partner: string | null | undefined, opponents: string[]): string {
  const us = partner ? `You and ${partner}` : "You";
  return `${us} versus ${andJoin(opponents)}`;
}

/** A team in standings and lists: "John Rapiel & Sam Lee" (D3). */
export function teamName(names: string[]): string {
  return names.join(" & ");
}

/** VoiceOver reads "&" as "and". */
export function teamSpoken(names: string[]): string {
  return andJoin(names);
}

/** A match seen by someone not in it: "John Rapiel and Sam Lee vs. Jo Park and Lee King". */
export function matchupLine(m: FourPlayers): string {
  return `${andJoin(sideNames(m, 1))} vs. ${andJoin(sideNames(m, 2))}`;
}

/** The recap line in team names (D7, decision 148): "John R. & Sam L. def. Jo P. & Lee K." */
export function recapTeams(winners: string[], losers: string[]): string {
  return `${winners.map(shortName).join(" & ")} def. ${losers.map(shortName).join(" & ")}`;
}

/** Manage > Teams: how each player without a partner shows (D2, D4, D9). */
export function unpairedLabel(kind: "needs_partner" | "looking" | "no_partner"): string {
  return kind === "needs_partner" ? "Needs a partner" : kind === "looking" ? "Looking for a partner" : "No partner yet";
}

/** "Expires Thu 3:00 PM" for a team-up request (48 hours, D9). */
export function expiresLine(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const ms = at.getTime() - now.getTime();
  if (ms < 3_600_000) return "Expires within the hour";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `Expires in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `Expires ${at.toLocaleDateString("en-US", { weekday: "short" })} ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
