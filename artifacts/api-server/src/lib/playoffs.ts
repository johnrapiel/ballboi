// League playoffs (spec: Leagues > Setup: "optional playoff for top 4 or 8").
// Pure, so it's easy to test.
//
// Seeds come from the standings, which rank on wins only (decision 23). A
// bracket needs a strict order, so players tied on wins are separated by:
//   1. head-to-head wins among the tied players,
//   2. share of sets won,
//   3. share of games won,
//   4. name, so the order is always the same.
// This tie-break order is a proposal pending John's decision; it lives only in
// `seedOrder` so it's a one-place change.

import { countsForStandings, type Standing, type StandingMatch } from "./leagueStandings.js";

export type PlayoffRound = "quarterfinal" | "semifinal" | "final";

/** Bracket size: the league's choice, shrunk to 4 if too few players, or 0 for none. */
export function bracketSize(playoffSize: number, activePlayers: number): 0 | 4 | 8 {
  if (playoffSize >= 8 && activePlayers >= 8) return 8;
  if (playoffSize >= 4 && activePlayers >= 4) return 4;
  return 0;
}

function share(won: number, lost: number): number {
  return won + lost > 0 ? won / (won + lost) : 0;
}

/** Standings in seed order, ties on wins broken as described above. */
export function seedOrder(standings: Standing[], matches: StandingMatch[]): Standing[] {
  const counted = matches.filter(countsForStandings);
  const byWins = new Map<number, Standing[]>();
  for (const s of standings) byWins.set(s.wins, [...(byWins.get(s.wins) ?? []), s]);

  const h2h = new Map<number, number>();
  for (const group of byWins.values()) {
    if (group.length < 2) continue;
    const ids = new Set(group.map((s) => s.playerId));
    for (const m of counted) {
      if (!ids.has(m.player1Id) || !ids.has(m.player2Id) || m.winnerId == null) continue;
      h2h.set(m.winnerId, (h2h.get(m.winnerId) ?? 0) + 1);
    }
  }

  return [...standings].sort(
    (a, b) =>
      b.wins - a.wins ||
      (h2h.get(b.playerId) ?? 0) - (h2h.get(a.playerId) ?? 0) ||
      share(b.setsWon, b.setsLost) - share(a.setsWon, a.setsLost) ||
      share(b.gamesWon, b.gamesLost) - share(a.gamesWon, a.gamesLost) ||
      a.playerName.localeCompare(b.playerName),
  );
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
export function bracketView(size: 4 | 8, seeds: BracketSeed[], matches: BracketMatchInput[]) {
  const seedOf = (id: number) => seeds.find((s) => s.playerId === id) ?? null;
  const first = roundNameFor(size / 2);
  const rounds: { round: PlayoffRound; slots: BracketSlotView[] }[] = [];
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
    rounds.push({ round: r, slots });
  }
  const final = matches.find((m) => m.playoffRound === "final" && m.winnerId != null);
  return { size, seeds, rounds, champion: final ? seedOf(final.winnerId!) : null };
}
