// Ball Boi's automatic posts in a league chat (decision 145): short and plain,
// like "Round 4 pairings are out." or "Sam Patel def. John Rapiel 6-3, 6-4."
// They show in the chat but never push or count on the Messages button
// (decision 146). Pure functions, so they're easy to test.

import { RETIRED_SUFFIX, WALKOVER_SCORE } from "./tennisScore.js";

export function pairingsPost(roundNumber: number): string {
  return `Round ${roundNumber} pairings are out.`;
}

/** "Sam Patel" or, in doubles, "Sam Patel and Ana Ruiz". */
function side(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return "A player";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/**
 * A result, with the score from the winners' side: "Sam Patel def. John
 * Rapiel 6-3, 6-4." An edit or an admin's correction starts with "Score
 * edited:". A retirement reads "6-3, 2-1, retired" and a walkover "by walkover".
 */
export function resultPost(input: { winners: string[]; losers: string[]; score: string | null; edited?: boolean }): string {
  const score = (input.score ?? "").trim();
  let tail: string;
  if (!score) tail = "";
  else if (score === WALKOVER_SCORE) tail = " by walkover";
  else if (score.endsWith(RETIRED_SUFFIX)) tail = ` ${score.slice(0, -RETIRED_SUFFIX.length).trim()}, retired`;
  else tail = ` ${score}`;
  const line = `${side(input.winners)} def. ${side(input.losers)}${tail}.`;
  return input.edited ? `Score edited: ${line}` : line;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export interface StandingRow {
  playerId: number;
  name: string;
  rank: number;
}

/** Most players named in one standings post. */
export const STANDINGS_POST_MAX = 3;

/**
 * Who moved up after a result, as one line: "Standings: Sam Patel moves up to
 * 1st." or "Standings: Sam Patel moves up to 1st, Ana Ruiz to 3rd." Null
 * when nobody moved up, or before the chat has standings to compare with.
 */
export function standingsPost(before: Record<string, number> | null, after: StandingRow[]): string | null {
  if (!before) return null;
  const movers = after
    .filter((r) => {
      const was = before[String(r.playerId)];
      return was !== undefined && r.rank < was;
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, STANDINGS_POST_MAX);
  if (!movers.length) return null;
  const [first, ...rest] = movers;
  const others = rest.map((r) => `, ${r.name} to ${ordinal(r.rank)}`).join("");
  return `Standings: ${first.name} moves up to ${ordinal(first.rank)}${others}.`;
}

/** What a chat remembers of the standings: player id to rank. */
export function standingsSnapshot(rows: StandingRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r.playerId), r.rank]));
}
