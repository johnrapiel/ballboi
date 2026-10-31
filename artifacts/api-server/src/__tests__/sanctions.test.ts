import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

let mockUserId: string | null = "user_bad";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../middlewares/requireAdmin", () => ({ requireAdmin: (_q: unknown, _s: unknown, next: () => void) => next() }));

import { createSanctionsGate } from "../messaging/enforceSanctions";
import { appealReference, MemorySanctionsRepo, SanctionsService, SUPPORT_EMAIL, type AccountIdentity } from "../messaging/sanctions";
import { createSanctionsRouter } from "../routes/sanctions";

const DAY = 86_400_000;
let now: Date;
let repo: MemorySanctionsRepo;
let svc: SanctionsService;
let appealReports: { clerkUserId: string; sanctionId: number }[];
let identities: Map<string, AccountIdentity>;

const bad: AccountIdentity = { clerkUserId: "user_bad", appleUserId: "apple.001", emails: ["bad@example.com"] };

beforeEach(() => {
  now = new Date("2026-10-31T21:00:00Z");
  mockUserId = "user_bad";
  repo = new MemorySanctionsRepo();
  appealReports = [];
  svc = new SanctionsService(
    repo,
    async ({ clerkUserId, sanction }) => {
      appealReports.push({ clerkUserId, sanctionId: sanction.id });
      return 900 + appealReports.length;
    },
    () => now,
  );
  identities = new Map([
    ["user_bad", bad],
    ["user_good", { clerkUserId: "user_good", appleUserId: "apple.002", emails: ["good@example.com"] }],
  ]);
});

function app(opts: { gate?: boolean } = {}) {
  const a = express();
  a.use(express.json());
  const getIdentity = async (id: string) => {
    const found = identities.get(id);
    if (!found) throw new Error("no such user");
    return found;
  };
  if (opts.gate) {
    a.use("/api", createSanctionsGate({ getService: () => svc, getIdentity, now: () => now.getTime() }).middleware);
    a.get("/api/leagues", (_q, r) => void r.json({ ok: true }));
    a.delete("/api/users/me", (_q, r) => void r.status(204).end());
  }
  a.use("/api", createSanctionsRouter({ getService: () => svc, getIdentity, onChange: () => undefined }));
  return a;
}

describe("bans stick", () => {
  it("catch a new account with the same Apple ID", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Threats", reportId: 4, by: "john" });
    const fresh = { clerkUserId: "user_new", appleUserId: "apple.001", emails: ["relay@privaterelay.appleid.com"] };
    expect((await svc.current(fresh))?.kind).toBe("ban");
  });

  it("catch a new account with the same email, in any case", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    expect(await svc.current({ clerkUserId: "user_new", appleUserId: null, emails: ["bad@example.com"] })).not.toBeNull();
    const row = repo.sanctions[0];
    expect(row.emails).toEqual(["bad@example.com"]);
    await svc.sanction({ kind: "ban", identity: { ...bad, emails: [" Mixed@Example.COM "] }, reason: "x", reportId: null, by: "john" });
    expect(repo.sanctions[1].emails).toEqual(["mixed@example.com"]);
  });

  it("leave everyone else alone", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    expect(await svc.current(identities.get("user_good")!)).toBeNull();
  });

  it("need a reason", async () => {
    await expect(svc.sanction({ kind: "ban", identity: bad, reason: "  ", reportId: null, by: "john" })).rejects.toThrow("reason");
  });
});

describe("suspensions", () => {
  it("end on their own", async () => {
    await svc.sanction({ kind: "suspend", identity: bad, reason: "Rude", reportId: null, days: 7, by: "john" });
    expect((await svc.status(bad)).status).toBe("suspended");
    expect((await svc.status(bad)).endsAt).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
    now = new Date(now.getTime() + 7 * DAY + 1);
    expect((await svc.status(bad)).status).toBe("ok");
  });

  it("last 1 to 90 days", async () => {
    for (const days of [0, 91, 1.5, "x", undefined]) {
      await expect(svc.sanction({ kind: "suspend", identity: bad, reason: "r", reportId: null, days, by: "john" })).rejects.toThrow("1 to 90");
    }
  });

  it("give way to a ban", async () => {
    await svc.sanction({ kind: "suspend", identity: bad, reason: "r", reportId: null, days: 3, by: "john" });
    await svc.sanction({ kind: "ban", identity: bad, reason: "r", reportId: null, by: "john" });
    expect((await svc.status(bad)).status).toBe("banned");
  });
});

describe("one appeal", () => {
  it("is logged in the reports queue once, then the person waits for an email", async () => {
    const s = await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    expect(await svc.status(bad)).toMatchObject({ status: "banned", canAppeal: true, appeal: null, supportEmail: SUPPORT_EMAIL });

    expect(await svc.appeal(bad)).toEqual({ reference: appealReference(s.id), supportEmail: SUPPORT_EMAIL });
    expect(appealReports).toEqual([{ clerkUserId: "user_bad", sanctionId: s.id }]);
    expect(repo.appeals[0]).toMatchObject({ sanctionId: s.id, reportId: 901 });
    expect(await svc.status(bad)).toMatchObject({ canAppeal: false, appeal: { outcome: null } });

    await expect(svc.appeal(bad)).rejects.toThrow("already appealed");
    expect(appealReports).toHaveLength(1);
  });

  it("overturned lifts the ban; upheld keeps it; each is decided once", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    await svc.appeal(bad);
    const appeal = repo.appeals[0];
    await expect(svc.decideAppeal(appeal.id, { outcome: "maybe", note: null, by: "john" })).rejects.toThrow("Outcome");
    await svc.decideAppeal(appeal.id, { outcome: "overturned", note: "Mistaken identity", by: "john" });
    expect((await svc.status(bad)).status).toBe("ok");
    await expect(svc.decideAppeal(appeal.id, { outcome: "upheld", note: null, by: "john" })).rejects.toThrow("already decided");

    mockUserId = "user_bad";
    await svc.sanction({ kind: "ban", identity: bad, reason: "Again", reportId: null, by: "john" });
    await svc.appeal(bad);
    await svc.decideAppeal(repo.appeals[1].id, { outcome: "upheld", note: null, by: "john" });
    expect(await svc.status(bad)).toMatchObject({ status: "banned", canAppeal: false, appeal: { outcome: "upheld" } });
  });

  it("can't be filed without a sanction", async () => {
    await expect(svc.appeal(bad)).rejects.toThrow("isn't banned");
  });
});

describe("sign-in gate", () => {
  it("blocks a banned account everywhere except status, appeal and account deletion", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    const a = app({ gate: true });
    const blocked = await supertest(a).get("/api/leagues");
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ code: "account_banned", error: "This account is banned." });
    expect((await supertest(a).get("/api/account/status")).body).toMatchObject({ status: "banned", canAppeal: true });
    expect((await supertest(a).post("/api/account/appeal")).status).toBe(201);
    expect((await supertest(a).delete("/api/users/me")).status).toBe(204);
  });

  it("blocks a new account that signs in with a banned Apple ID", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    identities.set("user_new", { clerkUserId: "user_new", appleUserId: "apple.001", emails: [] });
    mockUserId = "user_new";
    expect((await supertest(app({ gate: true })).get("/api/leagues")).status).toBe(403);
  });

  it("says suspended for suspensions, and lets everyone else through", async () => {
    await svc.sanction({ kind: "suspend", identity: bad, reason: "r", reportId: null, days: 2, by: "john" });
    const a = app({ gate: true });
    expect((await supertest(a).get("/api/leagues")).body.code).toBe("account_suspended");
    mockUserId = "user_good";
    expect((await supertest(a).get("/api/leagues")).status).toBe(200);
    mockUserId = null;
    expect((await supertest(a).get("/api/leagues")).status).toBe(200);
  });

  it("still checks the account id when Clerk can't be reached", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    identities.delete("user_bad");
    expect((await supertest(app({ gate: true })).get("/api/leagues")).status).toBe(403);
  });

  it("fails open if the check itself errors, rather than taking the API down", async () => {
    const broken = createSanctionsGate({
      getService: () => ({ noneActive: async () => { throw new Error("db down"); } }) as unknown as SanctionsService,
      getIdentity: async () => bad,
    });
    const next = vi.fn();
    const res = { status: vi.fn() } as unknown as Response;
    await broken.middleware({ method: "GET", path: "/leagues" } as Request, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});

describe("moderator routes", () => {
  it("ban, list, lift", async () => {
    mockUserId = "user_admin";
    const a = app();
    const ban = await supertest(a).post("/api/admin/accounts/user_bad/ban").send({ reason: "Threats in DMs", reportId: 12 });
    expect(ban.status).toBe(201);
    expect(ban.body.sanction).toMatchObject({ kind: "ban", clerkUserId: "user_bad", appleUserId: "apple.001", reportId: 12, createdBy: "user_admin" });
    expect((await supertest(a).get("/api/admin/sanctions")).body).toHaveLength(1);
    const lift = await supertest(a).post(`/api/admin/sanctions/${ban.body.sanction.id}/lift`);
    expect(lift.status).toBe(200);
    expect((await supertest(a).get("/api/admin/sanctions")).body).toHaveLength(0);
    expect((await supertest(a).post(`/api/admin/sanctions/${ban.body.sanction.id}/lift`)).status).toBe(409);
  });

  it("suspend checks days; unknown accounts are a 404", async () => {
    mockUserId = "user_admin";
    const a = app();
    expect((await supertest(a).post("/api/admin/accounts/user_bad/suspend").send({ reason: "r", days: 120 })).status).toBe(400);
    expect((await supertest(a).post("/api/admin/accounts/user_bad/suspend").send({ reason: "r", days: 14 })).status).toBe(201);
    expect((await supertest(a).post("/api/admin/accounts/user_ghost/ban").send({ reason: "r" })).status).toBe(404);
  });

  it("list open appeals and decide one", async () => {
    await svc.sanction({ kind: "ban", identity: bad, reason: "Spam", reportId: null, by: "john" });
    await svc.appeal(bad);
    mockUserId = "user_admin";
    const a = app();
    const open = await supertest(a).get("/api/admin/appeals");
    expect(open.body).toHaveLength(1);
    const decided = await supertest(a).post(`/api/admin/appeals/${open.body[0].id}/decide`).send({ outcome: "upheld", note: "Clear threats" });
    expect(decided.body.appeal).toMatchObject({ outcome: "upheld", note: "Clear threats", decidedBy: "user_admin" });
    expect((await supertest(a).get("/api/admin/appeals")).body).toHaveLength(0);
  });

  it("status needs sign-in", async () => {
    mockUserId = null;
    expect((await supertest(app()).get("/api/account/status")).status).toBe(401);
  });
});
