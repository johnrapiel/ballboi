import { describe, it, expect } from "vitest";
import {
  DOUBLES_WEIGHT,
  RATING_MAX,
  RATING_MIN,
  expectedScore,
  isQuizRating,
  rateMatch,
} from "../lib/rating";

const p = (clerkUserId: string, rating: number) => ({ clerkUserId, rating });

describe("Ball Boi Rating math", () => {
  it("even players expect a coin flip", () => {
    expect(expectedScore(3.5, 3.5)).toBeCloseTo(0.5);
  });

  it("moves two even singles players 0.04 each way (spec: 'Rating up 0.04 to 3.54')", () => {
    const [winner, loser] = rateMatch([{ players: [p("a", 3.5)] }, { players: [p("b", 3.5)] }], 0);
    expect(winner).toMatchObject({ clerkUserId: "a", before: 3.5, after: 3.54, delta: 0.04, weight: 1 });
    expect(loser).toMatchObject({ clerkUserId: "b", before: 3.5, after: 3.46, delta: -0.04, weight: 1 });
  });

  it("an upset moves more than an expected win", () => {
    const upset = rateMatch([{ players: [p("low", 3.0)] }, { players: [p("high", 4.0)] }], 0);
    const expected = rateMatch([{ players: [p("low", 3.0)] }, { players: [p("high", 4.0)] }], 1);
    expect(upset[0].delta).toBeGreaterThan(expected[1].delta);
    expect(upset[0].delta).toBeGreaterThan(0.04);
    expect(expected[1].delta).toBeLessThan(0.02);
  });

  it("counts doubles at half weight, same change for both partners", () => {
    const changes = rateMatch(
      [{ players: [p("a", 3.5), p("b", 3.5)] }, { players: [p("c", 3.5), p("d", 3.5)] }],
      1,
    );
    expect(changes.map((c) => c.weight)).toEqual([DOUBLES_WEIGHT, DOUBLES_WEIGHT, DOUBLES_WEIGHT, DOUBLES_WEIGHT]);
    expect(changes.map((c) => c.delta)).toEqual([-0.02, -0.02, 0.02, 0.02]);
  });

  it("uses each doubles team's average rating", () => {
    // Team averages are both 3.5, so it's an even match despite the mixed pairs.
    const changes = rateMatch(
      [{ players: [p("a", 3.0), p("b", 4.0)] }, { players: [p("c", 3.5), p("d", 3.5)] }],
      0,
    );
    expect(changes.slice(0, 2).map((c) => c.delta)).toEqual([0.02, 0.02]);
  });

  it("keeps ratings on the NTRP scale", () => {
    const [, floor] = rateMatch([{ players: [p("a", 3.0)] }, { players: [p("b", RATING_MIN)] }], 0);
    expect(floor.after).toBe(RATING_MIN);
    const [ceiling] = rateMatch([{ players: [p("a", RATING_MAX)] }, { players: [p("b", 6.9)] }], 0);
    expect(ceiling.after).toBe(RATING_MAX);
  });

  it("roughly zero-sum for singles, rounded to two decimals", () => {
    const changes = rateMatch([{ players: [p("a", 3.37)] }, { players: [p("b", 3.81)] }], 0);
    for (const c of changes) expect(c.after * 100).toBeCloseTo(Math.round(c.after * 100), 8);
    expect(Math.abs(changes[0].delta + changes[1].delta)).toBeLessThanOrEqual(0.01);
  });

  it("rejects an empty side", () => {
    expect(() => rateMatch([{ players: [] }, { players: [p("b", 3.5)] }], 0)).toThrow();
  });

  it("only accepts the quiz's starting ratings", () => {
    expect(isQuizRating(3.5)).toBe(true);
    expect(isQuizRating(3.6)).toBe(false);
    expect(isQuizRating("3.5")).toBe(false);
  });
});
