import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

import { checkSidecar, MAX_SIDECAR_BYTES, sidecarObjectPath } from "../lib/recordingSidecar";
import { sessionFiles } from "../lib/sessionFiles";

let mockUserId: string | null = "user_me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

const selectQueue: unknown[][] = [];
const updates: unknown[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  update: () => ({
    set: (values: unknown) => {
      updates.push(values);
      return { where: () => Promise.resolve() };
    },
  }),
};

function table(name: string, cols: string[]) {
  const t: Record<string, unknown> = { __name: name };
  for (const c of cols) t[c] = { table: name, col: c };
  return t;
}

vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  ballBoiSessionsTable: table("ball_boi_sessions", ["id", "matchId", "metadata", "recordedByClerkUserId"]),
  ballBoiDoublesViewsTable: table("ball_boi_doubles_views", ["clerkUserId", "matchId"]),
  leagueRoundsTable: table("league_rounds", ["id"]),
  leaguesTable: table("leagues", ["id"]),
  matchesTable: table("matches", ["id"]),
  matchInvitesTable: table("match_invites", ["id"]),
  playersTable: table("players", ["id"]),
  playoffBracketsTable: table("playoff_brackets", ["id"]),
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join("?"), values }),
}));

const puts: { path: string; body: string }[] = [];

async function app() {
  const mod = await import("../routes/recording.js");
  mod.setSidecarStoreForTests({
    putObject: async (path: string, body: string) => {
      puts.push({ path, body });
    },
  });
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api", mod.default);
  return supertest(a);
}

const sample = {
  sidecarVersion: 1,
  startedAt: "2026-11-10T18:00:00.000Z",
  captureStartedAt: "2026-11-10T18:01:00.000Z",
  stoppedAt: "2026-11-10T18:03:00.000Z",
  stopReason: "user",
  complete: true,
  device: { model: "iPhone15,2", iosVersion: "26.1", appVersion: "1.0.0", appBuild: "41" },
  capture: { lens: null, resolution: "1280x720", targetFps: 30, actualFps: null },
  courtLock: { lockedAtStart: true, confidenceAtStart: 0.81, relocks: [] },
  movement: { events: [{ at: "2026-11-10T18:02:00.000Z", tMs: 120000, kind: "bump", peakDegPerS: 22.5, peakAccelG: 0.3 }] },
  health: { interruptions: [] },
  conditions: null,
  missing: { "capture.actualFps": "Needs the capture-info native module (a new TestFlight build)." },
};

beforeEach(() => {
  mockUserId = "user_me";
  selectQueue.length = 0;
  updates.length = 0;
  puts.length = 0;
});

describe("checkSidecar", () => {
  it("keeps a version 1 sidecar and stamps the server's ids", () => {
    const r = checkSidecar(sample, { matchId: 7, sessionId: 42 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sidecar.matchId).toBe(7);
    expect(r.sidecar.sessionId).toBe(42);
    expect((r.sidecar.device as Record<string, unknown>).model).toBe("iPhone15,2");
  });

  it("refuses other versions and non-objects", () => {
    expect(checkSidecar({ ...sample, sidecarVersion: 2 }, { matchId: 1, sessionId: 1 }).ok).toBe(false);
    expect(checkSidecar([sample], { matchId: 1, sessionId: 1 }).ok).toBe(false);
    expect(checkSidecar(null, { matchId: 1, sessionId: 1 }).ok).toBe(false);
  });

  it("drops unknown sections, locations and names at any depth, and the phone's own ids", () => {
    const r = checkSidecar(
      {
        ...sample,
        matchId: 999,
        location: { lat: 1, lon: 2 },
        extra: "x",
        device: { ...sample.device, name: "John's iPhone" },
        health: { interruptions: [{ kind: "background", latitude: 40.1, longitude: -73.9 }] },
      },
      { matchId: 7, sessionId: 42 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.json).not.toMatch(/location|latitude|longitude|John's iPhone|extra/);
    expect(r.sidecar.matchId).toBe(7);
  });

  it("refuses one that's too big", () => {
    const big = { ...sample, missing: { pad: "x".repeat(MAX_SIDECAR_BYTES) } };
    expect(checkSidecar(big, { matchId: 1, sessionId: 1 })).toEqual({ ok: false, error: "The sidecar is too big." });
  });
});

describe("PUT /recording/sessions/:id/sidecar", () => {
  it("needs a signed-in user", async () => {
    mockUserId = null;
    const res = await (await app()).put("/api/recording/sessions/42/sidecar").send(sample);
    expect(res.status).toBe(401);
  });

  it("only the recorder can send it", async () => {
    selectQueue.push([{ id: 42, matchId: 7, recordedByClerkUserId: "someone_else", metadata: {} }]);
    const res = await (await app()).put("/api/recording/sessions/42/sidecar").send(sample);
    expect(res.status).toBe(403);
    expect(puts).toHaveLength(0);
  });

  it("404s for a missing session", async () => {
    selectQueue.push([]);
    const res = await (await app()).put("/api/recording/sessions/42/sidecar").send(sample);
    expect(res.status).toBe(404);
  });

  it("stores it next to the video and records its path on the session", async () => {
    selectQueue.push([{ id: 42, matchId: 7, recordedByClerkUserId: "user_me", metadata: {} }]);
    const res = await (await app()).put("/api/recording/sessions/42/sidecar").send(sample);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: true, objectPath: "/objects/sidecars/match-7/session-42.json" });
    expect(puts[0].path).toBe(sidecarObjectPath(7, 42));
    expect(JSON.parse(puts[0].body).movement.events[0].kind).toBe("bump");
    expect(JSON.stringify(updates[0])).toContain("sidecarPath");
  });

  it("refuses a bad sidecar without storing anything", async () => {
    selectQueue.push([{ id: 42, matchId: 7, recordedByClerkUserId: "user_me", metadata: {} }]);
    const res = await (await app()).put("/api/recording/sessions/42/sidecar").send({ sidecarVersion: 3 });
    expect(res.status).toBe(400);
    expect(puts).toHaveLength(0);
  });
});

describe("sessionFiles", () => {
  it("deletes the sidecar with the recording", () => {
    const files = sessionFiles({ id: 1, videoObjectPath: "/objects/uploads/a", metadata: { sidecarPath: "/objects/sidecars/match-7/session-1.json" } });
    expect(files.objects).toContain("/objects/sidecars/match-7/session-1.json");
  });
});
