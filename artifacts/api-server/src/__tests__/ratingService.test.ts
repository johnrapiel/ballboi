import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake database: each select returns the next queued result; writes are recorded.
const selectQueue: unknown[][] = [];
const writes: { op: string; table: string; values?: unknown }[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, err);
  return c;
}

const tx = {
  select: () => chain(() => selectQueue.shift() ?? []),
  insert: (t: { __name: string }) => ({
    values: async (values: unknown) => void writes.push({ op: "insert", table: t.__name, values }),
  }),
  update: (t: { __name: string }) => ({
    set: (values: unknown) => ({
      where: () => {
        writes.push({ op: "update", table: t.__name, values });
        const done = Promise.resolve([values]);
        return Object.assign(done, { returning: () => done });
      },
    }),
  }),
  delete: (t: { __name: string }) => ({
    where: async () => void writes.push({ op: "delete", table: t.__name }),
  }),
};
const fakeDb = { ...tx, transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };

vi.mock("@workspace/db", () => {
  const col = (name: string, cols: string[]) => Object.fromEntries([["__name", name], ...cols.map((c) => [c, {}])]);
  return {
    db: {},
    usersTable: col("users", ["id", "clerkUserId", "rating", "ratingSource"]),
    ratingHistoryTable: col("rating_history", ["id", "clerkUserId", "rating", "delta", "reason", "matchId", "weight", "createdAt"]),
  };
});

import { applyMatchResult, setSelfRating, RatingError } from "../services/ratingService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fakeDb as any;

beforeEach(() => {
  selectQueue.length = 0;
  writes.length = 0;
});

describe("applyMatchResult", () => {
  it("moves both singles ratings and records history for the trend line", async () => {
    selectQueue.push([], [
      { clerkUserId: "a", rating: 3.5 },
      { clerkUserId: "b", rating: 3.5 },
    ]);
    const out = await applyMatchResult({ matchId: 7, sides: [["a"], ["b"]], winner: 0 }, db);
    expect(out.applied).toBe(true);
    const history = writes.find((w) => w.table === "rating_history" && w.op === "insert");
    expect(history?.values).toEqual([
      { clerkUserId: "a", rating: 3.54, delta: 0.04, reason: "match", matchId: 7, weight: 1 },
      { clerkUserId: "b", rating: 3.46, delta: -0.04, reason: "match", matchId: 7, weight: 1 },
    ]);
    expect(writes.filter((w) => w.op === "update" && w.table === "users").map((w) => w.values)).toEqual([
      { rating: 3.54 },
      { rating: 3.46 },
    ]);
  });

  it("doesn't rate the same match twice", async () => {
    selectQueue.push([{ id: 1 }]);
    const out = await applyMatchResult({ matchId: 7, sides: [["a"], ["b"]], winner: 0 }, db);
    expect(out).toEqual({ applied: false, reason: "already_rated" });
    expect(writes).toHaveLength(0);
  });

  it("skips a match with a placeholder or unrated player", async () => {
    selectQueue.push([], [{ clerkUserId: "a", rating: 3.5 }]);
    const out = await applyMatchResult({ matchId: 8, sides: [["a"], ["placeholder"]], winner: 1 }, db);
    expect(out).toEqual({ applied: false, reason: "unrated_player" });
    expect(writes).toHaveLength(0);
  });

  it("rejects a player on both sides", async () => {
    await expect(applyMatchResult({ matchId: 9, sides: [["a"], ["a"]], winner: 0 }, db)).rejects.toThrow();
  });
});

describe("setSelfRating", () => {
  it("saves a Self-rated rating and replaces an earlier quiz answer", async () => {
    selectQueue.push([{ id: 1, ratingSource: null }], []);
    const out = await setSelfRating("a", 3.0, db);
    expect(out).toEqual({ rating: 3.0, ratingSource: "self" });
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(["delete:rating_history", "insert:rating_history", "update:users"]);
  });

  it("refuses once a UTR link has verified the rating", async () => {
    selectQueue.push([{ id: 1, ratingSource: "verified" }]);
    await expect(setSelfRating("a", 3.0, db)).rejects.toBeInstanceOf(RatingError);
  });

  it("refuses once results have moved the rating", async () => {
    selectQueue.push([{ id: 1, ratingSource: "self" }], [{ id: 5 }]);
    await expect(setSelfRating("a", 3.0, db)).rejects.toMatchObject({ status: 409 });
  });

  it("needs a profile first", async () => {
    selectQueue.push([]);
    await expect(setSelfRating("a", 3.0, db)).rejects.toMatchObject({ status: 404 });
  });
});
