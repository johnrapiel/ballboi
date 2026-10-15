/**
 * Unit tests for the circle-method (Berger tables) round-robin pairing
 * and the constraint-aware fallback matcher.
 *
 * Key guarantees verified:
 *  - No duplicate matchups within the first (n-1) rounds for any even n
 *  - 10-player league × 6 regular-season rounds → 0 duplicates
 *  - 10-player league × 9 rounds (full round-robin) → 0 duplicates
 *  - Odd player counts get a bye slot; no two real players are paired with null
 *  - Pairing is deterministic: same inputs always produce the same output
 *  - Player ordering is preserved (fixing the missing-sort regression)
 *  - constrainedPerfectMatch finds a valid 4-round tail for the production
 *    scenario where rounds 1-2 were generated with mismatched player orderings
 */
import { describe, it, expect } from "vitest";
import { circleMethodPairs, constrainedPerfectMatch } from "../services/roundPairing.js";

type FakePlayer = { id: number; name: string };

function makePlayers(ids: number[]): FakePlayer[] {
  return ids.map((id) => ({ id, name: `Player ${id}` }));
}

function pairKey(p1: FakePlayer, p2: FakePlayer): string {
  return [p1.id, p2.id].sort().join("-");
}

function collectAllPairKeys(players: FakePlayer[], rounds: number): string[] {
  const keys: string[] = [];
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const pairs = circleMethodPairs(players as any, roundIndex);
    for (const { p1, p2 } of pairs) {
      keys.push(pairKey(p1 as FakePlayer, p2 as FakePlayer));
    }
  }
  return keys;
}

describe("circleMethodPairs — 10-player league", () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  it("produces 5 matchups per round (n/2)", () => {
    const pairs = circleMethodPairs(players as any, 0);
    expect(pairs).toHaveLength(5);
  });

  it("produces zero duplicate matchups across 6 regular-season rounds", () => {
    const keys = collectAllPairKeys(players, 6);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("produces zero duplicate matchups across all 9 rounds (full round-robin)", () => {
    const keys = collectAllPairKeys(players, 9);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("covers all C(10,2)=45 unique pairs across 9 rounds", () => {
    const keys = collectAllPairKeys(players, 9);
    expect(new Set(keys).size).toBe(45);
    expect(keys).toHaveLength(45);
  });
});

describe("circleMethodPairs — determinism and sort-sensitivity", () => {
  it("returns identical pairings for the same player list and round index", () => {
    const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const first = circleMethodPairs(players as any, 0).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    const second = circleMethodPairs(players as any, 0).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    expect(first).toEqual(second);
  });

  it("produces different round-1 pairings when player list order changes (confirming sort matters)", () => {
    const ordered = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const shuffled = makePlayers([3, 1, 7, 2, 9, 5, 4, 8, 6, 10]);
    const pairsOrdered = circleMethodPairs(ordered as any, 0).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    const pairsShuffled = circleMethodPairs(shuffled as any, 0).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    expect(pairsOrdered).not.toEqual(pairsShuffled);
  });

  it("round index wraps correctly: roundIndex 9 is identical to roundIndex 0 for 10 players", () => {
    const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const r0 = circleMethodPairs(players as any, 0).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    const r9 = circleMethodPairs(players as any, 9).map(({ p1, p2 }) =>
      pairKey(p1 as FakePlayer, p2 as FakePlayer)
    );
    expect(r0).toEqual(r9);
  });
});

describe("circleMethodPairs — odd player count (bye slot)", () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7]);

  it("produces 3 matchups per round for 7 players (one bye each round)", () => {
    const pairs = circleMethodPairs(players as any, 0);
    expect(pairs).toHaveLength(3);
  });

  it("all returned pairs contain real players (no null-vs-null or null-in-pair)", () => {
    for (let roundIndex = 0; roundIndex < 6; roundIndex++) {
      const pairs = circleMethodPairs(players as any, roundIndex);
      for (const { p1, p2 } of pairs) {
        expect(p1).not.toBeNull();
        expect(p2).not.toBeNull();
      }
    }
  });

  it("produces zero duplicate matchups across 6 rounds for 7 players", () => {
    const keys = collectAllPairKeys(players, 6);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

describe("circleMethodPairs — edge cases", () => {
  it("returns empty array for fewer than 2 players", () => {
    expect(circleMethodPairs([] as any, 0)).toHaveLength(0);
    expect(circleMethodPairs(makePlayers([1]) as any, 0)).toHaveLength(0);
  });

  it("returns one pair for exactly 2 players", () => {
    const players = makePlayers([1, 2]);
    const pairs = circleMethodPairs(players as any, 0);
    expect(pairs).toHaveLength(1);
    expect(pairKey(pairs[0].p1 as FakePlayer, pairs[0].p2 as FakePlayer)).toBe("1-2");
  });
});

// ---------------------------------------------------------------------------
// constrainedPerfectMatch — production scenario regression tests
// ---------------------------------------------------------------------------

describe("constrainedPerfectMatch — basic correctness", () => {
  it("returns an empty array for zero players", () => {
    expect(constrainedPerfectMatch([], new Set())).toEqual([]);
  });

  it("returns null for an odd number of players", () => {
    expect(constrainedPerfectMatch([1, 2, 3], new Set())).toBeNull();
  });

  it("returns the only valid pair for 2 players with no used pairs", () => {
    const result = constrainedPerfectMatch([1, 2], new Set());
    expect(result).toEqual([[1, 2]]);
  });

  it("returns null when the only pair for 2 players is already used", () => {
    expect(constrainedPerfectMatch([1, 2], new Set(["1-2"]))).toBeNull();
  });

  it("finds a valid matching for 4 players with one pair used", () => {
    // 1-2 is used; valid matching must be {1-3, 2-4} or {1-4, 2-3}
    const result = constrainedPerfectMatch([1, 2, 3, 4], new Set(["1-2"]));
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    const usedInResult = new Set(result!.map(([a, b]) => [a, b].sort().join("-")));
    expect(usedInResult.has("1-2")).toBe(false);
    // each player appears exactly once
    const flat = result!.flat();
    expect(new Set(flat).size).toBe(4);
  });

  it("each player appears exactly once in the result", () => {
    const result = constrainedPerfectMatch([1, 2, 3, 4, 5, 6], new Set(["1-2", "3-4"]));
    expect(result).not.toBeNull();
    const flat = result!.flat();
    expect(flat.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("no pair in the result appears in usedPairKeys", () => {
    const used = new Set(["1-2", "1-3", "1-4", "2-3", "2-4"]);
    const result = constrainedPerfectMatch([1, 2, 3, 4], used);
    if (result !== null) {
      for (const [a, b] of result) {
        expect(used.has([a, b].sort().join("-"))).toBe(false);
      }
    }
  });
});

describe("constrainedPerfectMatch — production regression (10 players, mismatched rounds 1-2)", () => {
  /**
   * Replicates the exact production state of Hudson Valley Tennis league 1:
   *
   * Round 1 pairings (generated with an unsorted player list):
   *   Patrick(5)-Nathan(6), Paul(10)-Markos(8), Max(2)-Ross(9),
   *   Devan(3)-Alex(4), John(1)-Garrion(7)
   *
   * Round 2 pairings (generated separately with a different unsorted list):
   *   Paul(10)-Devan(3), Markos(8)-Alex(4), Max(2)-Nathan(6),
   *   Ross(9)-Patrick(5), John(1)-Garrion(7)  ← repeat of {1,7}!
   *
   * The circle-method at roundIndex 4 (round 5) would again produce {1,7},
   * {5,9}, and other conflicts. This test verifies that constrainedPerfectMatch
   * finds four additional rounds (rounds 3-6) with zero conflicts against
   * rounds 1-2 and zero internal conflicts.
   */
  const playerIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  // Actual pairs from production rounds 1 and 2
  const round1Pairs = ["5-6", "8-10", "2-9", "3-4", "1-7"];
  const round2Pairs = ["3-10", "4-8", "2-6", "5-9", "1-7"];
  const existingPairs = new Set([...round1Pairs, ...round2Pairs]);

  function runRound(used: Set<string>): [number, number][] {
    const result = constrainedPerfectMatch(playerIds, used);
    expect(result).not.toBeNull();
    return result!;
  }

  it("generates round 3 with no conflicts against rounds 1-2", () => {
    const pairs = runRound(new Set(existingPairs));
    for (const [a, b] of pairs) {
      const key = [a, b].sort().join("-");
      expect(existingPairs.has(key)).toBe(false);
    }
    // covers all 10 players exactly once
    expect(pairs.flat().sort((x, y) => x - y)).toEqual(playerIds);
  });

  it("generates rounds 3-6 with zero rematches against any prior round", () => {
    const used = new Set(existingPairs);
    const allNewKeys: string[] = [];

    for (let r = 3; r <= 6; r++) {
      const result = constrainedPerfectMatch(playerIds, used);
      expect(result).not.toBeNull();
      const roundKeys = result!.map(([a, b]) => [a, b].sort().join("-"));

      // No pair in this new round was already used
      for (const key of roundKeys) {
        expect(used.has(key)).toBe(false);
      }

      // Add to used set for next round
      for (const key of roundKeys) {
        used.add(key);
      }
      allNewKeys.push(...roundKeys);
    }

    // No pair appears more than once across the 4 new rounds themselves
    const uniqueNew = new Set(allNewKeys);
    expect(uniqueNew.size).toBe(allNewKeys.length);

    // All 20 pairs across rounds 3-6 are unique
    expect(allNewKeys).toHaveLength(20);
  });

  it("all 10 players appear exactly once in each new round", () => {
    const used = new Set(existingPairs);
    for (let r = 3; r <= 6; r++) {
      const result = constrainedPerfectMatch(playerIds, used);
      expect(result).not.toBeNull();
      const flat = result!.flat().sort((a, b) => a - b);
      expect(flat).toEqual(playerIds);
      result!.forEach(([a, b]) => used.add([a, b].sort().join("-")));
    }
  });

  it("John Rapiel (id=1) does not face Garrion Sirman (id=7) in rounds 3-6", () => {
    const used = new Set(existingPairs);
    for (let r = 3; r <= 6; r++) {
      const result = constrainedPerfectMatch(playerIds, used);
      expect(result).not.toBeNull();
      const hasRepeat = result!.some(
        ([a, b]) => (a === 1 && b === 7) || (a === 7 && b === 1)
      );
      expect(hasRepeat).toBe(false);
      result!.forEach(([a, b]) => used.add([a, b].sort().join("-")));
    }
  });
});
