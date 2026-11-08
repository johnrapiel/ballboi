// League playoffs (spec: Leagues > Setup: "optional playoff for top 4 or 8").
// Pure, so it's easy to test.
//
// Seeds come from the standings, which rank on wins (decision 23). Players
// level on wins are separated by:
//   1. head-to-head wins among the tied players,
//   2. share of sets won,
//   3. share of games won,
//   4. name, so the order is always the same.
// John chose this order on Oct 29, 2026, and on Nov 6 the standings took it
// too. It lives in `rankOrder` (leagueStandings.ts).

import { addDays, roundWindow, shortDate } from "./leagueCalendar.js";
import { countsForStandings, rankOrder, type Standing, type StandingMatch } from "./leagueStandings.js";
import { WALKOVER_SCORE } from "./tennisScore.js";

/** Days each playoff round gets: a play week plus a grace week (Q5b, Nov 4). */
export const PLAYOFF_ROUND_DAYS = 14;

export type PlayoffRound = "quarterfinal" | "semifinal" | "final";

/** Bracket size: the league's choice, shrunk to 4 if too few players, or 0 for none. */
export function bracketSize(playoffSize: number, activePlayers: number): 0 | 4 | 8 {
  if (playoffSize >= 8 && activePlayers >= 8) return 8;
  if (playoffSize >= 4 && activePlayers >= 4) return 4;
  return 0;
}

/** Standings in seed order, ties on wins broken as described above. */
export function seedOrder(standings: Standing[], matches: StandingMatch[]): Standing[] {
  return [...rankOrder(standings, matches.filter(countsForStandings))];
}

/** First-round pairings by seed: best plays worst, and 1 and 2 can only meet in the final. */
export function firstRoundSeeds(size: 4 | 8): [number, number][] {
  return size === 8
    ? [
        [1, 8],
        [4, 5],
        [3, 6],
        [2, 7],
      ]
    : [
        [1, 4],
        [2, 3],
      ];
}

/** The round name for a round with `matches` matches. */
export function roundNameFor(matches: number): PlayoffRound {
  return matches >= 4 ? "quarterfinal" : matches === 2 ? "semifinal" : "final";
}

export function nextRound(round: PlayoffRound): PlayoffRound | null {
  return round === "quarterfinal" ? "semifinal" : round === "semifinal" ? "final" : null;
}

export function matchesIn(round: PlayoffRound): number {
  return round === "quarterfinal" ? 4 : round === "semifinal" ? 2 : 1;
}

/** Where a slot's winner goes: the next round's slot, and whether they're player 1 or 2. */
export function advanceTo(slot: number): { slot: number; position: 1 | 2 } {
  return { slot: Math.ceil(slot / 2), position: slot % 2 === 1 ? 1 : 2 };
}

/** The slot that feeds the same next-round match as `slot`. */
export function partnerSlot(slot: number): number {
  return slot % 2 === 1 ? slot + 1 : slot - 1;
}

/** Rounds in a bracket of `size`, first round first. */
export function bracketRounds(size: 4 | 8): PlayoffRound[] {
  const out: PlayoffRound[] = [];
  for (let r: PlayoffRound | null = roundNameFor(size / 2); r; r = nextRound(r)) out.push(r);
  return out;
}

/**
 * A playoff round's dates (Q5b). Playoffs start the day after the regular
 * season's last deadline, and each round gets two weeks: a play week and a
 * grace week. The play-by date is the last day of those two weeks; after it,
 * the admin enters the result or a walkover.
 */
export function playoffRoundWindow(
  league: { startDate: string; seasonWeeks: number },
  size: 4 | 8,
  round: PlayoffRound,
): { startDate: string; playBy: string } | null {
  const index = bracketRounds(size).indexOf(round);
  if (index < 0) return null;
  const playoffsStart = addDays(roundWindow(league.startDate, league.seasonWeeks).deadline, 1);
  const startDate = addDays(playoffsStart, index * PLAYOFF_ROUND_DAYS);
  return { startDate, playBy: addDays(startDate, PLAYOFF_ROUND_DAYS - 1) };
}

export interface DropoutMatch {
  id: number;
  status: string;
  voidedAt: Date | null;
  player1Id: number;
  player2Id: number;
  playoffBracketId: number | null;
}

/**
 * What happens to a leaving player's matches (decision 27, Q5). Played
 * matches stay. Weekly matches still to play are cancelled. A playoff match
 * still to play goes to the opponent on a walkover (W/O), so the bracket keeps
 * moving; it's only cancelled if the opponent has left too.
 */
export function planDropout(
  matches: DropoutMatch[],
  playerId: number,
  stillPlaying: (playerId: number) => boolean,
): { voidIds: number[]; walkovers: { matchId: number; winnerId: number }[] } {
  const voidIds: number[] = [];
  const walkovers: { matchId: number; winnerId: number }[] = [];
  for (const m of matches) {
    if (m.status === "completed" || m.voidedAt) continue;
    const opponent = m.player1Id === playerId ? m.player2Id : m.player2Id === playerId ? m.player1Id : null;
    if (m.playoffBracketId && opponent != null && stillPlaying(opponent)) walkovers.push({ matchId: m.id, winnerId: opponent });
    else voidIds.push(m.id);
  }
  return { voidIds, walkovers };
}

/** The columns a walkover writes on a playoff match. */
export function walkoverResult(winnerId: number, now: Date = new Date()) {
  const at = now.toISOString();
  return { status: "completed", score: WALKOVER_SCORE, winnerId, completedAt: at, recordedAt: at, inGrace: false };
}

export interface BracketMatchInput {
  id: number;
  playoffRound: string | null;
  playoffSlot: number | null;
  player1Id: number;
  player2Id: number;
  status: string;
  score: string | null;
  winnerId: number | null;
}

export interface BracketSeed {
  seed: number;
  playerId: number;
  playerName: string;
}

export interface BracketSlotView {
  round: PlayoffRound;
  slot: number;
  matchId: number | null;
  player1: BracketSeed | null;
  player2: BracketSeed | null;
  status: string;
  score: string | null;
  winnerId: number | null;
}

/** Every slot of the bracket, played or still to come, plus the champion once there is one. */
export function bracketView(
  size: 4 | 8,
  seeds: BracketSeed[],
  matches: BracketMatchInput[],
  /** The league's dates, for each round's play-by date (Q5b). Older leagues have none. */
  calendar?: { league: { startDate: string; seasonWeeks: number }; today: string } | null,
) {
  const seedOf = (id: number) => seeds.find((s) => s.playerId === id) ?? null;
  const first = roundNameFor(size / 2);
  const rounds: { round: PlayoffRound; slots: BracketSlotView[]; playBy: string | null; pastPlayBy: boolean }[] = [];
  for (let r: PlayoffRound | null = first; r; r = nextRound(r)) {
    const slots: BracketSlotView[] = [];
    for (let slot = 1; slot <= matchesIn(r); slot++) {
      const m = matches.find((x) => x.playoffRound === r && x.playoffSlot === slot);
      let player1: BracketSeed | null = m ? seedOf(m.player1Id) : null;
      let player2: BracketSeed | null = m ? seedOf(m.player2Id) : null;
      if (!m && r === first) {
        const [a, b] = firstRoundSeeds(size)[slot - 1];
        player1 = seeds.find((s) => s.seed === a) ?? null;
        player2 = seeds.find((s) => s.seed === b) ?? null;
      }
      if (!m && r !== first) {
        // Show whoever has already won their way here.
        const before = matches.filter((x) => x.playoffRound !== r && x.winnerId != null);
        for (const feeder of before) {
          if (!feeder.playoffSlot || nextRound(feeder.playoffRound as PlayoffRound) !== r) continue;
          const to = advanceTo(feeder.playoffSlot);
          if (to.slot !== slot) continue;
          if (to.position === 1) player1 = seedOf(feeder.winnerId!);
          else player2 = seedOf(feeder.winnerId!);
        }
      }
      slots.push({
        round: r,
        slot,
        matchId: m?.id ?? null,
        player1,
        player2,
        status: m?.status ?? "waiting",
        score: m?.score ?? null,
        winnerId: m?.winnerId ?? null,
      });
    }
    const playBy = calendar ? playoffRoundWindow(calendar.league, size, r)?.playBy ?? null : null;
    rounds.push({ round: r, slots, playBy, pastPlayBy: !!playBy && !!calendar && calendar.today > playBy });
  }
  const final = matches.find((m) => m.playoffRound === "final" && m.winnerId != null);
  return { size, seeds, rounds, champion: final ? seedOf(final.winnerId!) : null };
}

/** Why an admin can't settle this playoff match yet, or null when they can (Q5b). */
export function settleProblem(input: {
  match: { playoffBracketId: number | null; status: string; voidedAt: Date | null; player1Id: number | null; player2Id: number | null };
  leagueEnded: boolean;
  playBy: string | null;
  today: string;
}): { status: number; error: string } | null {
  if (input.leagueEnded) return { status: 409, error: "This league has ended, so its scores are final." };
  if (!input.match.playoffBracketId || !input.playBy) return { status: 409, error: "Only playoff matches past their play-by date are settled here." };
  if (input.match.voidedAt) return { status: 409, error: "This match was cancelled when a player left the league." };
  if (input.match.status === "completed") return { status: 409, error: "A score is already in for this match. The first score entered stands." };
  if (input.match.player1Id == null || input.match.player2Id == null) {
    return { status: 409, error: "This match is still waiting for a player from the round before." };
  }
  if (input.today <= input.playBy) {
    return { status: 409, error: `The players have until ${shortDate(input.playBy)} to play. After that you can enter the result.` };
  }
  return null;
}
