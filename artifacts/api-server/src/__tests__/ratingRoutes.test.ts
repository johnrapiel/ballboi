import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_rater";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const setSelfRating = vi.fn();
const getRating = vi.fn();

vi.mock("../services/ratingService", () => {
  class RatingError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    RatingError,
    setSelfRating: (...a: unknown[]) => setSelfRating(...a),
    getRating: (...a: unknown[]) => getRating(...a),
  };
});

import ratingsRouter from "../routes/ratings";
import { RatingError } from "../services/ratingService";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", ratingsRouter);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_rater";
  setSelfRating.mockReset();
  getRating.mockReset();
});

describe("POST /users/me/rating/self", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().post("/api/users/me/rating/self").send({ rating: 3.5 }).expect(401);
  });

  it("only accepts a quiz rating", async () => {
    await app().post("/api/users/me/rating/self").send({ rating: 3.7 }).expect(400);
    await app().post("/api/users/me/rating/self").send({ rating: "3.5" }).expect(400);
    expect(setSelfRating).not.toHaveBeenCalled();
  });

  it("saves a Self-rated starting rating", async () => {
    setSelfRating.mockResolvedValue({ rating: 3.5, ratingSource: "self" });
    const res = await app().post("/api/users/me/rating/self").send({ rating: 3.5 }).expect(200);
    expect(setSelfRating).toHaveBeenCalledWith("user_rater", 3.5);
    expect(res.body).toEqual({ rating: 3.5, source: "self" });
  });

  it("passes through a conflict, such as a Verified rating", async () => {
    setSelfRating.mockRejectedValue(new RatingError("Your rating comes from your linked UTR account.", 409));
    const res = await app().post("/api/users/me/rating/self").send({ rating: 3.0 }).expect(409);
    expect(res.body.error).toMatch(/UTR/);
  });
});

describe("GET /users/me/rating", () => {
  it("returns the rating and history", async () => {
    getRating.mockResolvedValue({ rating: 3.54, source: "self", history: [{ rating: 3.5 }, { rating: 3.54 }] });
    const res = await app().get("/api/users/me/rating").expect(200);
    expect(res.body.history).toHaveLength(2);
  });

  it("404s before the profile exists", async () => {
    getRating.mockResolvedValue(null);
    await app().get("/api/users/me/rating").expect(404);
  });
});
