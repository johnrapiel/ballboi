import { describe, it, expect } from "vitest";
import { advanceTo, bracketSize, bracketView, firstRoundSeeds, partnerSlot, seedOrder } from "../lib/playoffs.js";
import type { Standing, StandingMatch } from "../lib/leagueStandings.js";

// Spec: Leagues > Setup, optional playoff for top 4 or 8. Seeds follow the
// wins-only standings; ties on wins use head-to-head, then sets, then games.

function st(playerId: number, playerName: string, wins: number, extra: Partial<Standing> = {}): Standing {
  return {
    rank: 0, playerId, playerName, wins, losses: 0, matchesPlayed: wins, winRate: 1, points: 0,
    setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0, ...extra,
  };
}

function m(p1: number, p2: number, winnerId: number): StandingMatch {
  return {
    status: "completed", winnerId, player1Id: p1, player2Id: p2, player3Id: null, player4Id: null,
    score: "6-4, 6-4", season: null, voidedAt: null, inGrace: false, playoffBracketId: null,
  };
}

describe("seedOrder", () => {
  it("seeds by wins first", () => {
    const order = seedOrder([st(1, "A", 2), st(2, "B", 5), st(3, "C", 3)], []);
    expect(order.map((s) => s.playerId)).toEqual([2, 3, 1]);
  });

  it("breaks a tie on wins with head-to-head", () => {
    const order = seedOrder([st(1, "Alex", 3), st(2, "Blair", 3)], [m(1, 2, 2)]);
    expect(order.map((s) => s.playerId)).toEqual([2, 1]);
  });

  it("ignores grace-week results in head-to-head", () => {
    const grace = { ...m(1, 2, 2), inGrace: true };
    const order = seedOrder([st(1, "Alex", 3), st(2, "Blair", 3)], [grace]);
    expect(order.map((s) => s.playerId)).toEqual([1, 2]); // falls through to name
  });

  it("then uses share of sets, then games", () => {
    const order = seedOrder(
      [
        st(1, "Alex", 3, { setsWon: 6, setsLost: 4 }),
        st(2, "Blair", 3, { setsWon: 6, setsLost: 2 }),
        st(3, "Casey", 3, { setsWon: 6, setsLost: 2, gamesWon: 40, gamesLost: 20 }),
      ],
      [],
    );
    expect(order.map((s) => s.playerId)).toEqual([3, 2, 1]);
  });
});

describe("bracket shape", () => {
  it("shrinks to 4 when there aren't enough players for 8, and skips under 4", () => {
    expect(bracketSize(8, 10)).toBe(8);
    expect(bracketSize(8, 6)).toBe(4);
    expect(bracketSize(4, 3)).toBe(0);
    expect(bracketSize(0, 10)).toBe(0);
  });

  it("pairs best against worst so 1 and 2 can only meet in the final", () => {
    expect(firstRoundSeeds(4)).toEqual([[1, 4], [2, 3]]);
    expect(firstRoundSeeds(8)).toEqual([[1, 8], [4, 5], [3, 6], [2, 7]]);
  });

  it("sends winners to the right next slot", () => {
    expect(advanceTo(1)).toEqual({ slot: 1, position: 1 });
    expect(advanceTo(2)).toEqual({ slot: 1, position: 2 });
    expect(advanceTo(4)).toEqual({ slot: 2, position: 2 });
    expect(partnerSlot(3)).toBe(4);
    expect(partnerSlot(2)).toBe(1);
  });
});

describe("bracketView", () => {
  const seeds = [1, 2, 3, 4].map((n) => ({ seed: n, playerId: n * 10, playerName: `P${n}` }));

  it("shows the semifinals, a final waiting on both, and no champion yet", () => {
    const view = bracketView(4, seeds, [
      { id: 1, playoffRound: "semifinal", playoffSlot: 1, player1Id: 10, player2Id: 40, status: "completed", score: "6-1, 6-1", winnerId: 10 },
      { id: 2, playoffRound: "semifinal", playoffSlot: 2, player1Id: 20, player2Id: 30, status: "scheduled", score: null, winnerId: null },
    ]);
    expect(view.rounds.map((r) => r.round)).toEqual(["semifinal", "final"]);
    const final = view.rounds[1].slots[0];
    expect(final.matchId).toBeNull();
    expect(final.player1?.playerName).toBe("P1");
    expect(final.player2).toBeNull();
    expect(view.champion).toBeNull();
  });

  it("names the champion once the final is in", () => {
    const view = bracketView(4, seeds, [
      { id: 1, playoffRound: "semifinal", playoffSlot: 1, player1Id: 10, player2Id: 40, status: "completed", score: "6-1, 6-1", winnerId: 10 },
      { id: 2, playoffRound: "semifinal", playoffSlot: 2, player1Id: 20, player2Id: 30, status: "completed", score: "6-1, 6-1", winnerId: 30 },
      { id: 3, playoffRound: "final", playoffSlot: 1, player1Id: 10, player2Id: 30, status: "completed", score: "3-6, 3-6", winnerId: 30 },
    ]);
    expect(view.champion?.playerName).toBe("P3");
  });

  it("lists all four quarterfinals for an 8-player bracket before any match exists", () => {
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ seed: n, playerId: n, playerName: `P${n}` }));
    const view = bracketView(8, eight, []);
    expect(view.rounds[0].slots.map((s) => [s.player1?.seed, s.player2?.seed])).toEqual([[1, 8], [4, 5], [3, 6], [2, 7]]);
    expect(view.rounds.map((r) => r.slots.length)).toEqual([4, 2, 1]);
  });
});
