import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_rater";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

// Each select returns the next queued result; updates are recorded.
const selectQueue: unknown[][] = [];
const updates: unknown[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectQueue.shift() ?? [] }) }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            const v = values as { rating: number; ratingSource: string };
            return [{ rating: v.rating, ratingSource: v.ratingSource }];
          },
        }),
      }),
    }),
  },
  usersTable: { clerkUserId: {}, rating: {}, ratingSource: {} },
}));

import ratingsRouter from "../routes/ratings";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", ratingsRouter);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_rater";
  selectQueue.length = 0;
  updates.length = 0;
});

describe("POST /users/me/rating/self", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().post("/api/users/me/rating/self").send({ rating: 3.5 }).expect(401);
  });

  it("only accepts a quiz level", async () => {
    await app().post("/api/users/me/rating/self").send({ rating: 3.7 }).expect(400);
    await app().post("/api/users/me/rating/self").send({ rating: "3.5" }).expect(400);
    expect(updates).toHaveLength(0);
  });

  it("saves a Self-rated level", async () => {
    selectQueue.push([{ ratingSource: null }]);
    const res = await app().post("/api/users/me/rating/self").send({ rating: 3.5 }).expect(200);
    expect(updates).toEqual([{ rating: 3.5, ratingSource: "self" }]);
    expect(res.body).toEqual({ rating: 3.5, source: "self" });
  });

  it("can be changed anytime", async () => {
    selectQueue.push([{ ratingSource: "self" }]);
    await app().post("/api/users/me/rating/self").send({ rating: 4.0 }).expect(200);
    expect(updates).toEqual([{ rating: 4.0, ratingSource: "self" }]);
  });

  it("leaves a Verified rating alone", async () => {
    selectQueue.push([{ ratingSource: "verified" }]);
    const res = await app().post("/api/users/me/rating/self").send({ rating: 3.0 }).expect(409);
    expect(res.body.error).toMatch(/UTR/);
    expect(updates).toHaveLength(0);
  });

  it("needs a profile first", async () => {
    selectQueue.push([]);
    await app().post("/api/users/me/rating/self").send({ rating: 3.0 }).expect(404);
  });
});
