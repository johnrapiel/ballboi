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
            Promise.resolve([
              {
                consentedAt: values.consentedAt ?? null,
                trainingEnabled: values.trainingEnabled,
                releaseVersion: values.releaseVersion ?? null,
                releaseAgreedAt: values.releaseAgreedAt ?? null,
              },
            ]),
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

const releaseOff = {
  required: false,
  version: 1,
  url: "https://ballboi.tennis/beta-release",
  agreedVersion: null,
  agreedAt: null,
  needed: false,
};

beforeEach(() => {
  delete process.env.BETA_RELEASE_REQUIRED;
  delete process.env.BETA_RELEASE_VERSION;
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
    expect(res.body).toEqual({ consented: false, consentedAt: null, trainingEnabled: true, release: releaseOff });
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
    expect(res.body).toEqual({ consented: false, consentedAt: null, trainingEnabled: false, release: releaseOff });
    expect(upserts[0].set).not.toHaveProperty("consentedAt");
  });

  it("rejects a missing choice and signed-out callers", async () => {
    expect((await (await app()).post("/api/recording/consent").send({})).status).toBe(400);
    mockUserId = null;
    expect((await (await app()).get("/api/recording/consent")).status).toBe(401);
  });
});

describe("beta footage release", () => {
  it("reads the server setting, off by default", async () => {
    const { readBetaRelease, releaseNeeded } = await import("../lib/betaRelease.js");
    expect(readBetaRelease({})).toEqual({ required: false, version: 1 });
    expect(readBetaRelease({ BETA_RELEASE_REQUIRED: "true", BETA_RELEASE_VERSION: "3" })).toEqual({ required: true, version: 3 });
    expect(readBetaRelease({ BETA_RELEASE_REQUIRED: "1", BETA_RELEASE_VERSION: "nope" })).toEqual({ required: true, version: 1 });
    expect(releaseNeeded({ required: false, version: 2 }, null)).toBe(false);
    expect(releaseNeeded({ required: true, version: 2 }, null)).toBe(true);
    expect(releaseNeeded({ required: true, version: 2 }, 1)).toBe(true);
    expect(releaseNeeded({ required: true, version: 2 }, 2)).toBe(false);
  });

  it("asks a beta account that hasn't agreed", async () => {
    process.env.BETA_RELEASE_REQUIRED = "true";
    selectQueue.push([{ consentedAt: new Date("2026-11-01T00:00:00Z"), trainingEnabled: true, releaseVersion: null }]);
    const res = await (await app()).get("/api/recording/consent");
    expect(res.body.consented).toBe(true);
    expect(res.body.release).toMatchObject({ required: true, version: 1, needed: true, agreedVersion: null });
  });

  it("asks again, unchecked, after the version is bumped", async () => {
    process.env.BETA_RELEASE_REQUIRED = "true";
    process.env.BETA_RELEASE_VERSION = "2";
    selectQueue.push([
      { consentedAt: new Date(), trainingEnabled: true, releaseVersion: 1, releaseAgreedAt: new Date("2026-11-07T00:00:00Z") },
    ]);
    const res = await (await app()).get("/api/recording/consent");
    expect(res.body.release).toMatchObject({ version: 2, agreedVersion: 1, needed: true });
  });

  it("refuses consent without the box checked while the release is required", async () => {
    process.env.BETA_RELEASE_REQUIRED = "true";
    selectQueue.push([]);
    const res = await (await app()).post("/api/recording/consent").send({ trainingEnabled: true });
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("stores the version and date when the box is checked", async () => {
    process.env.BETA_RELEASE_REQUIRED = "true";
    process.env.BETA_RELEASE_VERSION = "2";
    const res = await (await app()).post("/api/recording/consent").send({ trainingEnabled: true, releaseVersion: 2 });
    expect(res.status).toBe(200);
    expect(upserts[0].values).toMatchObject({ releaseVersion: 2 });
    expect(upserts[0].values.releaseAgreedAt).toBeInstanceOf(Date);
    expect(res.body.release).toMatchObject({ agreedVersion: 2, needed: false });
  });

  it("doesn't need the box again once the current version is agreed", async () => {
    process.env.BETA_RELEASE_REQUIRED = "true";
    selectQueue.push([{ consentedAt: new Date(), trainingEnabled: true, releaseVersion: 1 }]);
    const res = await (await app()).post("/api/recording/consent").send({ trainingEnabled: false });
    expect(res.status).toBe(200);
    expect(upserts[0].values).not.toHaveProperty("releaseVersion");
  });

  it("ignores a release version when the release is off", async () => {
    const res = await (await app()).post("/api/recording/consent").send({ trainingEnabled: true, releaseVersion: 1 });
    expect(res.status).toBe(200);
    expect(upserts[0].values).not.toHaveProperty("releaseVersion");
  });
});
