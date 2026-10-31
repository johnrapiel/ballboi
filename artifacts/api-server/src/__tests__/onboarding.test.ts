import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_new";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { deleteUser: vi.fn() } },
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayersForUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/accountDeletion.js", () => ({ deleteAccount: vi.fn() }));

const updates: unknown[] = [];
let returned: unknown[] = [{ id: 1 }];

vi.mock("@workspace/db", () => ({
  db: {
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            return returned;
          },
        }),
      }),
    }),
  },
  usersTable: { clerkUserId: {} },
}));

import usersRouter from "../routes/users";
import { parseHomeArea } from "../lib/onboarding";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", usersRouter);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_new";
  updates.length = 0;
  returned = [{ id: 1 }];
});

describe("parseHomeArea", () => {
  it("accepts a zip on its own, without location", () => {
    expect(parseHomeArea({ zip: "12590" })).toEqual({ zip: "12590", latitude: null, longitude: null });
  });

  it("rounds coordinates so only an approximate location is stored", () => {
    expect(parseHomeArea({ zip: "12508", latitude: 41.504812, longitude: -73.969671 })).toEqual({
      zip: "12508",
      latitude: 41.5,
      longitude: -73.97,
    });
  });

  it("rejects a bad zip, half a location, or out-of-range coordinates", () => {
    expect(parseHomeArea({ zip: "1259" })).toHaveProperty("error");
    expect(parseHomeArea({ zip: "abcde" })).toHaveProperty("error");
    expect(parseHomeArea({ zip: "12590", latitude: 41.5 })).toHaveProperty("error");
    expect(parseHomeArea({ zip: "12590", latitude: 141, longitude: 0 })).toHaveProperty("error");
  });
});

describe("PUT /users/me/home-area", () => {
  it("needs sign-in", async () => {
    mockUserId = null;
    await app().put("/api/users/me/home-area").send({ zip: "12590" }).expect(401);
  });

  it("saves the zip and approximate location", async () => {
    await app().put("/api/users/me/home-area").send({ zip: "12590", latitude: 41.50481, longitude: -73.96967 }).expect(200);
    expect(updates).toEqual([{ homeZip: "12590", homeLatitude: 41.5, homeLongitude: -73.97 }]);
  });

  it("explains a bad zip", async () => {
    const res = await app().put("/api/users/me/home-area").send({ zip: "125" }).expect(400);
    expect(res.body.error).toBe("Enter a 5-digit zip code.");
  });

  it("404s before the profile exists", async () => {
    returned = [];
    await app().put("/api/users/me/home-area").send({ zip: "12590" }).expect(404);
  });
});

describe("PUT /users/me/intent", () => {
  it("saves the answer and completes onboarding", async () => {
    await app().put("/api/users/me/intent").send({ intent: "join_league" }).expect(200);
    expect(updates).toEqual([{ intent: "join_league", onboardingComplete: true }]);
  });

  it("only accepts the four options", async () => {
    await app().put("/api/users/me/intent").send({ intent: "coach" }).expect(400);
    expect(updates).toHaveLength(0);
  });
});
