import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const selectQueue: unknown[][] = [];
const upserts: { values: Record<string, unknown>; set: Record<string, unknown> }[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
        upserts.push({ values, set });
        return {
          returning: () =>
            Promise.resolve([{ consentedAt: values.consentedAt ?? null, trainingEnabled: values.trainingEnabled }]),
        };
      },
    }),
  }),
};

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  recordingConsentTable: { clerkUserId: {}, trainingEnabled: {}, consentedAt: {} },
  matchesTable: {},
  playersTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
}));

async function app() {
  const { default: router } = await import("../routes/trainingConsent.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

beforeEach(() => {
  mockUserId = "user_me";
  selectQueue.length = 0;
  upserts.length = 0;
});

describe("isTrainingEligible", () => {
  it("needs every player to have an account and training on", async () => {
    const { isTrainingEligible } = await import("../lib/trainingEligibility.js");
    expect(isTrainingEligible([{ clerkUserId: "a" }, { clerkUserId: "b" }], new Set())).toBe(true);
    expect(isTrainingEligible([{ clerkUserId: "a" }, { clerkUserId: "b" }], new Set(["b"]))).toBe(false);
    // Placeholder opponent who hasn't joined: never trained on.
    expect(isTrainingEligible([{ clerkUserId: "a" }, { clerkUserId: null }], new Set())).toBe(false);
    expect(isTrainingEligible([], new Set())).toBe(false);
  });
});

describe("consent routes", () => {
  it("defaults to not consented with training on", async () => {
    selectQueue.push([]);
    const res = await (await app()).get("/api/recording/consent");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consented: false, consentedAt: null, trainingEnabled: true });
  });

  it("records consent with the toggle as chosen", async () => {
    const res = await (await app()).post("/api/recording/consent").send({ trainingEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.consented).toBe(true);
    expect(res.body.trainingEnabled).toBe(false);
    expect(upserts[0].values).toMatchObject({ clerkUserId: "user_me", trainingEnabled: false });
    expect(upserts[0].values.consentedAt).toBeInstanceOf(Date);
  });

  it("changes training without counting as consent", async () => {
    const res = await (await app()).put("/api/recording/training").send({ trainingEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consented: false, consentedAt: null, trainingEnabled: false });
    expect(upserts[0].set).not.toHaveProperty("consentedAt");
  });

  it("rejects a missing choice and signed-out callers", async () => {
    expect((await (await app()).post("/api/recording/consent").send({})).status).toBe(400);
    mockUserId = null;
    expect((await (await app()).get("/api/recording/consent")).status).toBe(401);
  });
});
