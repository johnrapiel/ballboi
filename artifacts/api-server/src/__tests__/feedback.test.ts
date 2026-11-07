import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_me";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return c;
}

const mockDb = {
  select: () => chain(() => selectQueue.shift() ?? []),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      inserted.push(values);
      return { returning: () => Promise.resolve([{ id: 42, createdAt: new Date("2026-11-07T18:00:00Z"), ...values }]) };
    },
  }),
  update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => (updated.push(v), Promise.resolve()) }) }),
};

const col = (t: string, cols: string[]) => Object.fromEntries(cols.map((c) => [c, { t, c }]));
vi.mock("@workspace/db", () => ({
  get db() {
    return mockDb;
  },
  supportReportsTable: col("support_reports", ["id", "clerkUserId", "createdAt"]),
  matchesTable: col("matches", ["id"]),
  playersTable: col("players", ["id", "clerkUserId"]),
  usersTable: col("users", ["clerkUserId", "displayName", "email"]),
}));
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  and: (...a: unknown[]) => a,
  gte: (a: unknown, b: unknown) => ({ a, b }),
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  sql: () => ({}),
}));

const send = vi.fn();

async function app() {
  const { feedbackRouter } = await import("../routes/feedback.js");
  const a = express();
  a.use(express.json());
  a.use("/api", feedbackRouter({ send }));
  return supertest(a);
}

const device = { appVersion: "1.0.0", deviceModel: "iPhone (393×852 pt)", osVersion: "26.1" };

beforeEach(() => {
  mockUserId = "user_me";
  selectQueue.length = 0;
  inserted.length = 0;
  updated.length = 0;
  send.mockReset().mockResolvedValue({ sent: true });
});

describe("parseFeedback", () => {
  it("needs a problem, and text for Something else", async () => {
    const { parseFeedback } = await import("../routes/feedback.js");
    expect(parseFeedback({}).ok).toBe(false);
    expect(parseFeedback({ problem: "nope" }).ok).toBe(false);
    expect(parseFeedback({ problem: "something_else", note: "   " })).toEqual({ ok: false, error: "Tell us what's not working." });
    const ok = parseFeedback({ problem: "upload_stuck", source: "processing", matchId: "7", ...device });
    expect(ok).toEqual({ ok: true, value: { problem: "upload_stuck", note: null, source: "processing", matchId: 7, ...device } });
  });

  it("refuses an overlong note and falls back to settings for an unknown source", async () => {
    const { parseFeedback, MAX_NOTE } = await import("../routes/feedback.js");
    expect(parseFeedback({ problem: "app_froze", note: "x".repeat(MAX_NOTE + 1) }).ok).toBe(false);
    const r = parseFeedback({ problem: "app_froze", source: "somewhere" });
    expect(r.ok && r.value.source).toBe("settings");
  });
});

describe("POST /feedback (B3)", () => {
  it("saves the report with device details and the match, then emails support", async () => {
    selectQueue.push(
      [{ n: 0 }], // reports this hour
      [{ id: 7, player1Id: 1, player2Id: 2, player3Id: null, player4Id: null }],
      [{ id: 1 }], // the sender plays in it
      [{ name: "John", email: "john@example.com" }],
    );
    const res = await (await app())
      .post("/api/feedback")
      .send({ problem: "something_else", note: "The timer froze", source: "processing", matchId: 7, ...device });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 42 });
    expect(inserted[0]).toMatchObject({ clerkUserId: "user_me", problem: "something_else", note: "The timer froze", matchId: 7, ...device });
    const email = send.mock.calls[0][0];
    expect(email.subject).toBe("Something not working: Something else (#42)");
    expect(email.text).toContain("iOS: 26.1");
    expect(email.text).toContain("Match: 7");
    expect(email.replyTo).toBe("john@example.com");
    expect(updated[0].emailedAt).toBeInstanceOf(Date);
  });

  it("keeps the report when the email doesn't go out", async () => {
    send.mockResolvedValue({ sent: false, reason: "not_configured" });
    selectQueue.push([{ n: 0 }], []);
    const res = await (await app()).post("/api/feedback").send({ problem: "upload_stuck", source: "settings", ...device });
    expect(res.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(updated).toHaveLength(0);
  });

  it("drops a match the sender didn't play in", async () => {
    selectQueue.push([{ n: 0 }], [{ id: 7, player1Id: 3, player2Id: 4, player3Id: null, player4Id: null }], [], []);
    await (await app()).post("/api/feedback").send({ problem: "score_not_saved", matchId: 7 });
    expect(inserted[0].matchId).toBeNull();
  });

  it("refuses Something else without text, too many reports, and signed-out callers", async () => {
    expect((await (await app()).post("/api/feedback").send({ problem: "something_else" })).status).toBe(400);
    selectQueue.push([{ n: 10 }]);
    expect((await (await app()).post("/api/feedback").send({ problem: "app_froze" })).status).toBe(429);
    mockUserId = null;
    expect((await (await app()).post("/api/feedback").send({ problem: "app_froze" })).status).toBe(401);
  });
});

describe("sendSupportEmail", () => {
  it("does nothing without a key, and posts to Resend with one", async () => {
    const { sendSupportEmail } = await import("../lib/supportEmail.js");
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect(await sendSupportEmail({ subject: "s", text: "t" }, { env: {}, fetch: f })).toEqual({ sent: false, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    expect(await sendSupportEmail({ subject: "s", text: "t" }, { env: { RESEND_API_KEY: "re_x" }, fetch: f })).toEqual({ sent: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body)).toMatchObject({ to: ["support@ballboi.tennis"], subject: "s", text: "t" });
    f.mockResolvedValue({ ok: false, status: 422 });
    expect((await sendSupportEmail({ subject: "s", text: "t" }, { env: { RESEND_API_KEY: "re_x" }, fetch: f })).sent).toBe(false);
  });
});
