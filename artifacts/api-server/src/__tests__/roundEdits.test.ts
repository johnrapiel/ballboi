import { describe, it, expect } from "vitest";
import { planBye, planLock, planSwap, unpairedPlayers, type DraftRound } from "../lib/roundEdits.js";

// Spec: Leagues > Weekly loop, step 2. Admins can swap pairings, mark a bye,
// or lock a match before the round goes out.

const draft: DraftRound = {
  published: false,
  matches: [
    { id: 10, player1Id: 1, player2Id: 2, locked: false },
    { id: 11, player1Id: 3, player2Id: 4, locked: false },
    { id: 12, player1Id: 5, player2Id: 6, locked: true },
  ],
  byes: [{ playerId: 7, setByAdmin: false }],
  activePlayerIds: [1, 2, 3, 4, 5, 6, 7, 8],
};

describe("unpairedPlayers", () => {
  it("lists active players with no match or bye", () => {
    expect(unpairedPlayers(draft)).toEqual([8]);
  });
});

describe("planSwap", () => {
  it("swaps players between two matches", () => {
    expect(planSwap(draft, 2, 3)).toEqual({
      matchUpdates: [
        { matchId: 10, player1Id: 1, player2Id: 3 },
        { matchId: 11, player1Id: 2, player2Id: 4 },
      ],
      byeMoves: [],
    });
  });

  it("swaps a player with the one on a bye", () => {
    expect(planSwap(draft, 7, 1)).toEqual({
      matchUpdates: [{ matchId: 10, player1Id: 7, player2Id: 2 }],
      byeMoves: [{ fromPlayerId: 7, toPlayerId: 1 }],
    });
  });

  it("puts an unpaired player into a match, leaving the other unpaired", () => {
    expect(planSwap(draft, 8, 4)).toEqual({
      matchUpdates: [{ matchId: 11, player1Id: 3, player2Id: 8 }],
      byeMoves: [],
    });
  });

  it("won't change a locked match", () => {
    expect(planSwap(draft, 1, 5)).toEqual({ error: "Unlock that match before changing it." });
  });

  it("won't swap opponents in the same match, or after the round goes out", () => {
    expect(planSwap(draft, 1, 2)).toHaveProperty("error");
    expect(planSwap({ ...draft, published: true }, 2, 3)).toHaveProperty("error");
  });
});

describe("planBye", () => {
  it("removes the player's match so their opponent can be re-paired", () => {
    expect(planBye(draft, 3)).toEqual({ deleteMatchId: 11 });
  });

  it("gives an unpaired player a bye without touching matches", () => {
    expect(planBye(draft, 8)).toEqual({ deleteMatchId: null });
  });

  it("refuses locked matches, double byes, and players outside the league", () => {
    expect(planBye(draft, 5)).toHaveProperty("error");
    expect(planBye(draft, 7)).toHaveProperty("error");
    expect(planBye(draft, 99)).toHaveProperty("error");
  });
});

describe("planLock", () => {
  it("locks a match in this round, only before it goes out", () => {
    expect(planLock(draft, 10)).toBeNull();
    expect(planLock(draft, 99)).toMatch(/isn't in this round/);
    expect(planLock({ ...draft, published: true }, 10)).toMatch(/already gone out/);
  });
});
