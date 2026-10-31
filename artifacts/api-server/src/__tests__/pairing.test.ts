import { describe, it, expect } from "vitest";
import {
  FLEX_WEIGHTS,
  ROUND_ROBIN_WEIGHTS,
  minCostMatching,
  pairCost,
  pairKey,
  pairRound,
  ratingValue,
  slotKeys,
  type PairingPlayer,
} from "../lib/pairing.js";

// Spec: Leagues > Weekly loop. Flex pairs by rating, availability, and who
// hasn't played whom; admins can lock pairings and mark byes.

function p(id: number, rating = 3.5, extra: Partial<PairingPlayer> = {}): PairingPlayer {
  return { id, rating, slots: null, byes: 0, ...extra };
}

function opponents(pairs: [number, number][], id: number): number | undefined {
  const pair = pairs.find(([a, b]) => a === id || b === id);
  return pair ? (pair[0] === id ? pair[1] : pair[0]) : undefined;
}

describe("pairCost", () => {
  it("adds cost for rematches, rating gaps, and no shared availability", () => {
    const history = new Map([[pairKey(1, 2), 2]]);
    expect(pairCost(p(1, 3.0), p(2, 4.0), history, FLEX_WEIGHTS)).toBe(2 * 10 + 1 * 4);
    expect(pairCost(p(1, 3.5, { slots: ["1-18"] }), p(3, 3.5, { slots: ["2-18"] }), new Map(), FLEX_WEIGHTS)).toBe(3);
    expect(pairCost(p(1, 3.5, { slots: ["1-18"] }), p(3, 3.5, { slots: ["1-18"] }), new Map(), FLEX_WEIGHTS)).toBe(0);
  });

  it("doesn't penalize players who haven't set availability", () => {
    expect(pairCost(p(1, 3.5, { slots: ["1-18"] }), p(3, 3.5), new Map(), FLEX_WEIGHTS)).toBe(0);
  });
});

describe("pairRound (Flex)", () => {
  it("pairs close ratings together", () => {
    const { pairs, byes } = pairRound({
      players: [p(1, 3.0), p(2, 4.5), p(3, 3.0), p(4, 4.5)],
      history: new Map(),
      weights: FLEX_WEIGHTS,
      roundNumber: 1,
    });
    expect(byes).toEqual([]);
    expect(opponents(pairs, 1)).toBe(3);
    expect(opponents(pairs, 2)).toBe(4);
  });

  it("avoids a rematch even if the ratings are a little further apart", () => {
    const { pairs } = pairRound({
      players: [p(1, 3.0), p(2, 3.0), p(3, 3.5), p(4, 3.5)],
      history: new Map([[pairKey(1, 2), 1], [pairKey(3, 4), 1]]),
      weights: FLEX_WEIGHTS,
      roundNumber: 2,
    });
    expect(opponents(pairs, 1)).not.toBe(2);
    expect(opponents(pairs, 3)).not.toBe(4);
  });

  it("prefers players who share a time to play", () => {
    const { pairs } = pairRound({
      players: [
        p(1, 3.5, { slots: ["2-18"] }),
        p(2, 3.5, { slots: ["6-9"] }),
        p(3, 3.5, { slots: ["2-18"] }),
        p(4, 3.5, { slots: ["6-9"] }),
      ],
      history: new Map(),
      weights: FLEX_WEIGHTS,
      roundNumber: 1,
    });
    expect(opponents(pairs, 1)).toBe(3);
  });

  it("gives the bye to someone who hasn't had one, rotating by round", () => {
    const players = [p(1, 3.5, { byes: 1 }), p(2), p(3), p(4), p(5)];
    const r1 = pairRound({ players, history: new Map(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    const r2 = pairRound({ players, history: new Map(), weights: FLEX_WEIGHTS, roundNumber: 2 });
    expect(r1.byes).toHaveLength(1);
    expect(r1.byes[0]).not.toBe(1);
    expect(r2.byes[0]).not.toBe(r1.byes[0]);
    expect(r1.pairs.flat().sort()).not.toContain(r1.byes[0]);
  });

  it("keeps locked pairings and admin byes as they are", () => {
    const { pairs, byes } = pairRound({
      players: [p(1, 3.0), p(2, 5.0), p(3, 3.0), p(4, 5.0), p(5, 4.0)],
      history: new Map(),
      weights: FLEX_WEIGHTS,
      lockedPairs: [[1, 2]],
      lockedByes: [5],
      roundNumber: 1,
    });
    expect(pairs).toContainEqual([1, 2]);
    expect(byes).toEqual([5]);
    expect(opponents(pairs, 3)).toBe(4);
  });

  it("pairs everyone in a big league", () => {
    const players = Array.from({ length: 31 }, (_, i) => p(i + 1, 2.5 + (i % 6) * 0.5));
    const { pairs, byes } = pairRound({ players, history: new Map(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    expect(byes).toHaveLength(1);
    expect(new Set([...pairs.flat(), ...byes]).size).toBe(31);
  });
});

describe("pairRound (Round robin)", () => {
  it("has everyone meet everyone once over n-1 rounds", () => {
    const players = [1, 2, 3, 4, 5, 6].map((id) => p(id, 2.5 + id * 0.3));
    const history = new Map<string, number>();
    for (let round = 1; round <= 5; round++) {
      const { pairs } = pairRound({ players, history, weights: ROUND_ROBIN_WEIGHTS, roundNumber: round });
      for (const [a, b] of pairs) {
        expect(history.get(pairKey(a, b)) ?? 0).toBe(0);
        history.set(pairKey(a, b), 1);
      }
    }
    expect(history.size).toBe(15);
  });
});

describe("minCostMatching", () => {
  it("finds the cheapest overall matching, not just the cheapest first pair", () => {
    // Greedy would take 1-2 (cost 1) and be forced into 3-4 (cost 100).
    const costs: Record<string, number> = { "1-2": 1, "3-4": 100, "1-3": 2, "2-4": 2, "1-4": 50, "2-3": 50 };
    const pairs = minCostMatching([p(1), p(2), p(3), p(4)], (a, b) => costs[pairKey(a.id, b.id)]);
    expect(pairs.map(([a, b]) => pairKey(a, b)).sort()).toEqual(["1-3", "2-4"]);
  });
});

describe("helpers", () => {
  it("reads ratings and availability", () => {
    expect(ratingValue("4.0")).toBe(4);
    expect(ratingValue("intermediate")).toBe(3);
    expect(slotKeys([{ dayOfWeek: 2, hour: 18 }])).toEqual(["2-18"]);
    expect(slotKeys([])).toBeNull();
  });
});
