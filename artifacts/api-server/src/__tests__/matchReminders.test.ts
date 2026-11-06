import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Wave 2: Match day reminders are on by default, with one switch per account
// in Profile (spec decision 73).

let mockUserId: string | null = "user_a";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { deleteUser: vi.fn() } },
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayersForUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/accountDeletion.js", () => ({ deleteAccount: vi.fn() }));
vi.mock("../lib/playerProfile.js", () => ({ syncProfileName: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/profilePhoto.js", () => ({ deleteOldPhoto: vi.fn(), newPhotoProblem: vi.fn().mockResolvedValue(null) }));

const existing = { id: 1, clerkUserId: "user_a", displayName: "Alex", avatarUrl: null, matchRemindersEnabled: true };
const updates: Record<string, unknown>[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [existing] }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            return [{ ...existing, ...values }];
          },
        }),
      }),
    }),
  },
  usersTable: { clerkUserId: {} },
}));

import usersRouter from "../routes/users";
import { remindedUserIds } from "../lib/matchReminders";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", usersRouter);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_a";
  updates.length = 0;
});

describe("PUT /users/me matchRemindersEnabled", () => {
  it("turns reminders off and back on for the account", async () => {
    const off = await app().put("/api/users/me").send({ matchRemindersEnabled: false }).expect(200);
    expect(off.body.matchRemindersEnabled).toBe(false);
    await app().put("/api/users/me").send({ matchRemindersEnabled: true }).expect(200);
    expect(updates).toEqual([{ matchRemindersEnabled: false }, { matchRemindersEnabled: true }]);
  });

  it("takes only true or false", async () => {
    await app().put("/api/users/me").send({ matchRemindersEnabled: "no" }).expect(400);
    expect(updates).toEqual([]);
  });

  it("needs sign-in", async () => {
    mockUserId = null;
    await app().put("/api/users/me").send({ matchRemindersEnabled: false }).expect(401);
  });
});

describe("remindedUserIds", () => {
  const p = (clerkUserId: string | null, dayBeforeMatchReminderEnabled = true) => ({ clerkUserId, dayBeforeMatchReminderEnabled });

  it("reminds every signed-up player by default", () => {
    expect(remindedUserIds([p("a"), p("b")], new Set())).toEqual(["a", "b"]);
  });

  it("skips accounts that turned reminders off in Profile", () => {
    expect(remindedUserIds([p("a"), p("b")], new Set(["b"]))).toEqual(["a"]);
  });

  it("still honors the older per-league switch", () => {
    expect(remindedUserIds([p("a", false), p("b")], new Set())).toEqual(["b"]);
  });

  it("skips placeholder players and missing rows, and names an account once", () => {
    expect(remindedUserIds([p(null), null, undefined, p("a"), p("a")], new Set())).toEqual(["a"]);
  });
});
