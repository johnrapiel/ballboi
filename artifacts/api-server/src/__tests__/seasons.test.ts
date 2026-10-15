/**
 * Tests for season overlap rejection — seasons route (POST / PATCH) and
 * findOverlappingSeason service function.
 *
 * Unit tests inspect the actual Drizzle predicate structure that is passed to
 * `db.select().from().where()` so that boundary date math, leagueId scoping,
 * and excludeId self-exclusion are all concretely verified — not just the
 * pass-through mapping of DB result → response.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Auth / Clerk mocks
// ──────────────────────────────────────────────────────────────────────────────
const ADMIN_EMAIL = "admin@example.com";
let mockGetAuth: () => { userId: string | null } = () => ({ userId: "user_admin" });
let mockGetUser: () => Promise<{
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string;
}> = async () => ({
  emailAddresses: [{ id: "email_1", emailAddress: ADMIN_EMAIL }],
  primaryEmailAddressId: "email_1",
});

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => mockGetAuth(),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: { getUser: (_id: string) => mockGetUser() },
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// DB mock — named column identifiers so predicate assertions are meaningful
// ──────────────────────────────────────────────────────────────────────────────
//
// Each column is given a unique string token.  drizzle-orm helpers are also
// mocked to return plain objects that carry their operator name and arguments,
// so the tests can inspect the predicate tree built by findOverlappingSeason.
//
// e.g. lte(seasonsTable.startDate, "2026-08-31")
//      → { op: "lte", a: "col:startDate", b: "2026-08-31" }

export const COLS = {
  id: "col:id",
  leagueId: "col:leagueId",
  name: "col:name",
  startDate: "col:startDate",
  endDate: "col:endDate",
  createdAt: "col:createdAt",
  updatedAt: "col:updatedAt",
} as const;

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  get db() { return mockDb; },
  seasonsTable: {
    id: COLS.id,
    leagueId: COLS.leagueId,
    name: COLS.name,
    startDate: COLS.startDate,
    endDate: COLS.endDate,
    createdAt: COLS.createdAt,
    updatedAt: COLS.updatedAt,
    $inferSelect: {},
    $inferInsert: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  eq:       (a: unknown, b: unknown)    => ({ op: "eq",       a, b }),
  and:      (...args: unknown[])        => ({ op: "and",      args }),
  or:       (...args: unknown[])        => ({ op: "or",       args }),
  isNull:   (a: unknown)               => ({ op: "isNull",   a }),
  isNotNull:(a: unknown)               => ({ op: "isNotNull",a }),
  lte:      (a: unknown, b: unknown)    => ({ op: "lte",      a, b }),
  gte:      (a: unknown, b: unknown)    => ({ op: "gte",      a, b }),
  lt:       (a: unknown, b: unknown)    => ({ op: "lt",       a, b }),
  gt:       (a: unknown, b: unknown)    => ({ op: "gt",       a, b }),
  ne:       (a: unknown, b: unknown)    => ({ op: "ne",       a, b }),
  desc:     (a: unknown)               => a,
  asc:      (a: unknown)               => a,
  inArray:  (a: unknown, b: unknown)    => ({ op: "inArray",  a, b }),
  count:    ()                         => ({ count: 1 }),
  not:      (a: unknown)               => ({ op: "not",       a }),
  sql: Object.assign(
    (_s: TemplateStringsArray, ..._v: unknown[]) => ({ queryChunks: [], shouldInlineParams: false }),
    { raw: (_s: string) => ({ queryChunks: [], shouldInlineParams: false }) }
  ),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Chain helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Blind chain — returns resolveValue, ignores all arguments. */
const mockChain = (resolveValue: unknown = []) => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then")    return (fn: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(fn);
      if (prop === "catch")   return (fn: (e: unknown) => unknown) => Promise.resolve(resolveValue).catch(fn);
      if (prop === "finally") return (fn: () => void)              => Promise.resolve(resolveValue).finally(fn);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
};

/**
 * Capturing chain — intercepts `.where(condition)` and stores `condition` in
 * the supplied `capture` ref before continuing to return the thenable chain.
 */
const capturingChain = (capture: { value: unknown }, resolveValue: unknown = []) => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "where") {
        return (condition: unknown) => {
          capture.value = condition;
          return new Proxy({}, handler);
        };
      }
      if (prop === "then")    return (fn: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(fn);
      if (prop === "catch")   return (fn: (e: unknown) => unknown) => Promise.resolve(resolveValue).catch(fn);
      if (prop === "finally") return (fn: () => void)              => Promise.resolve(resolveValue).finally(fn);
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
};

// ──────────────────────────────────────────────────────────────────────────────
// App builder (seasons route only)
// ──────────────────────────────────────────────────────────────────────────────
async function buildApp() {
  const { default: seasonsRouter } = await import("../routes/seasons.js");
  const app = express();
  app.use(express.json());
  app.use("/api", seasonsRouter);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

const makeDbSeason = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  leagueId: 1,
  name: "Spring Exhibition",
  startDate: "2026-01-01",
  endDate: "2026-05-31",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;

  mockGetAuth = () => ({ userId: "user_admin" });
  mockGetUser = async () => ({
    emailAddresses: [{ id: "email_1", emailAddress: ADMIN_EMAIL }],
    primaryEmailAddressId: "email_1",
  });

  mockDb.select.mockReturnValue(mockChain([]));
  mockDb.insert.mockReturnValue(mockChain([]));
  mockDb.update.mockReturnValue(mockChain([]));
  mockDb.delete.mockReturnValue(mockChain([]));

  app = await buildApp();
});

// ══════════════════════════════════════════════════════════════════════════════
// Unit tests — findOverlappingSeason predicate construction
//
// These tests verify that the correct Drizzle predicates are assembled for the
// overlap query: boundary date strings, leagueId visibility scope, and
// excludeId self-exclusion.  A bug in any of those conditions (wrong column,
// wrong operator, wrong value) would be caught here.
// ══════════════════════════════════════════════════════════════════════════════
describe("findOverlappingSeason — predicate construction", () => {
  // Helper: run findOverlappingSeason and return the captured where predicate.
  async function captureWhere(
    leagueId: number | null,
    startDate: string,
    endDate: string,
    excludeId?: number,
    dbRows: unknown[] = [],
  ) {
    const capture = { value: undefined as unknown };
    mockDb.select.mockReturnValue(capturingChain(capture, dbRows));
    const { findOverlappingSeason } = await import("../services/seasonService.js");
    const result = await findOverlappingSeason(leagueId, startDate, endDate, excludeId);
    return { predicate: capture.value as { op: string; args: unknown[] }, result };
  }

  // Helper: find a direct child condition by op inside an `and` predicate.
  function findArg(pred: { args: unknown[] }, op: string): Record<string, unknown> | undefined {
    return (pred.args as Record<string, unknown>[]).find((a) => a.op === op);
  }

  beforeEach(() => {
    vi.resetModules();
  });

  // ── Boundary date predicates ──────────────────────────────────────────────

  it("lte condition uses seasonsTable.startDate and the proposed endDate", async () => {
    const { predicate } = await captureWhere(1, "2026-06-01", "2026-08-31");

    expect(predicate.op).toBe("and");
    const lteCond = findArg(predicate, "lte");
    expect(lteCond).toBeDefined();
    expect(lteCond!.a).toBe(COLS.startDate);  // existing season's startDate column
    expect(lteCond!.b).toBe("2026-08-31");    // proposed endDate — boundary
  });

  it("gte condition uses seasonsTable.endDate and the proposed startDate", async () => {
    const { predicate } = await captureWhere(1, "2026-06-01", "2026-08-31");

    const gteCond = findArg(predicate, "gte");
    expect(gteCond).toBeDefined();
    expect(gteCond!.a).toBe(COLS.endDate);    // existing season's endDate column
    expect(gteCond!.b).toBe("2026-06-01");    // proposed startDate — boundary
  });

  it("adjacency boundary: proposed startDate one day after existing endDate passes correct values", async () => {
    // Scenario: existing season ends 2026-05-31; proposed season starts 2026-06-01.
    // The overlap predicates built into the query must be:
    //   lte(seasonsTable.startDate, "2026-08-31")  — existing start <= proposed end
    //   gte(seasonsTable.endDate,   "2026-06-01")  — existing end   >= proposed start
    //
    // For an existing season with endDate "2026-05-31":
    //   gte("2026-05-31", "2026-06-01") → false  → no match → no overlap ✓
    // Verifying the predicate is built with exactly "2026-06-01" as the gte bound
    // ensures this adjacency boundary will behave correctly in the real DB.
    const { predicate } = await captureWhere(1, "2026-06-01", "2026-08-31");

    const lteCond = findArg(predicate, "lte");
    const gteCond = findArg(predicate, "gte");
    expect(lteCond!.a).toBe(COLS.startDate);
    expect(lteCond!.b).toBe("2026-08-31"); // proposed endDate
    expect(gteCond!.a).toBe(COLS.endDate);
    expect(gteCond!.b).toBe("2026-06-01"); // proposed startDate — the critical boundary value
  });

  it("same-day boundary: proposed startDate equals existing endDate encodes inclusive overlap", async () => {
    // Existing ends 2026-05-31; new starts 2026-05-31.
    // gte(endDate, "2026-05-31") → TRUE for existing endDate of 2026-05-31 → overlap detected.
    const { predicate } = await captureWhere(1, "2026-05-31", "2026-08-31");

    const gteCond = findArg(predicate, "gte");
    expect(gteCond!.b).toBe("2026-05-31"); // boundary is inclusive
  });

  // ── leagueId scoping ──────────────────────────────────────────────────────

  it("with a leagueId, includes an `or` visibility filter (isNull OR eq leagueId)", async () => {
    const { predicate } = await captureWhere(42, "2026-06-01", "2026-08-31");

    const orCond = findArg(predicate, "or") as { op: string; args: unknown[] } | undefined;
    expect(orCond).toBeDefined();

    const orArgs = orCond!.args as Record<string, unknown>[];
    const nullCheck  = orArgs.find((a) => a.op === "isNull");
    const eqCheck    = orArgs.find((a) => a.op === "eq");
    expect(nullCheck).toBeDefined();
    expect(nullCheck!.a).toBe(COLS.leagueId);   // isNull(seasonsTable.leagueId)
    expect(eqCheck).toBeDefined();
    expect(eqCheck!.a).toBe(COLS.leagueId);     // eq(seasonsTable.leagueId, 42)
    expect(eqCheck!.b).toBe(42);
  });

  it("with leagueId=null (global), no `or` visibility filter is added (checks all seasons)", async () => {
    const { predicate } = await captureWhere(null, "2026-06-01", "2026-08-31");

    // No or condition — global check covers every season without a scope filter
    const orCond = findArg(predicate, "or");
    expect(orCond).toBeUndefined();
  });

  // ── excludeId self-exclusion ──────────────────────────────────────────────

  it("with excludeId, includes a `ne` condition on the id column with the given id", async () => {
    const { predicate } = await captureWhere(1, "2026-01-01", "2026-05-31", 10);

    const neCond = findArg(predicate, "ne");
    expect(neCond).toBeDefined();
    expect(neCond!.a).toBe(COLS.id);   // ne(seasonsTable.id, 10)
    expect(neCond!.b).toBe(10);
  });

  it("without excludeId, no `ne` condition is added", async () => {
    const { predicate } = await captureWhere(1, "2026-06-01", "2026-08-31");

    const neCond = findArg(predicate, "ne");
    expect(neCond).toBeUndefined();
  });

  // ── Return value mapping ──────────────────────────────────────────────────

  it("returns null when the DB query returns no rows", async () => {
    const { result } = await captureWhere(1, "2026-06-01", "2026-08-31", undefined, []);
    expect(result).toBeNull();
  });

  it("returns the first DB row when one is found", async () => {
    const conflicting = { id: 5, name: "Spring Exhibition", startDate: "2026-01-01", endDate: "2026-05-31" };
    const { result } = await captureWhere(1, "2026-05-01", "2026-07-31", undefined, [conflicting]);
    expect(result).toEqual(conflicting);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route integration tests — POST /api/leagues/:leagueId/seasons
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /api/leagues/:leagueId/seasons — overlap validation", () => {
  it("no conflict found → 201 with the created season", async () => {
    const newSeason = makeDbSeason({ id: 11, name: "Summer League", startDate: "2026-06-01", endDate: "2026-08-31" });
    mockDb.select.mockReturnValue(mockChain([]));      // findOverlappingSeason → no conflict
    mockDb.insert.mockReturnValue(mockChain([newSeason]));

    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Summer League", startDate: "2026-06-01", endDate: "2026-08-31" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Summer League");
    expect(res.body.startDate).toBe("2026-06-01");
    expect(res.body.endDate).toBe("2026-08-31");
  });

  it("exact-boundary adjacency (new season starts day after existing ends) → 201 allowed", async () => {
    // Existing season: 2026-01-01 – 2026-05-31  (Spring Exhibition)
    // Proposed season: 2026-06-01 – 2026-08-31  (starts the very next day)
    // The overlap predicate gte(endDate, "2026-06-01") is false for endDate "2026-05-31",
    // so the DB returns no rows and the route must respond 201.
    const newSeason = makeDbSeason({ id: 11, name: "Summer League", startDate: "2026-06-01", endDate: "2026-08-31" });
    mockDb.select.mockReturnValue(mockChain([])); // adjacent → no row returned → no conflict
    mockDb.insert.mockReturnValue(mockChain([newSeason]));

    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Summer League", startDate: "2026-06-01", endDate: "2026-08-31" });

    expect(res.status).toBe(201);
    expect(res.body.startDate).toBe("2026-06-01");
  });

  it("single-day overlap (new season starts on the last day of existing) → 409 rejected", async () => {
    // Existing season ends 2026-05-31; proposed season also starts 2026-05-31.
    // The overlap predicate gte(endDate, "2026-05-31") is true for endDate "2026-05-31" → overlap.
    const conflict = makeDbSeason(); // Spring Exhibition, ends 2026-05-31
    mockDb.select.mockReturnValue(mockChain([conflict]));

    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Summer League", startDate: "2026-05-31", endDate: "2026-08-31" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overlaps with existing season "Spring Exhibition"/i);
    expect(res.body.error).toContain("2026-05-31");
    expect(res.body.conflictingSeasonId).toBe(10);
  });

  it("league-scoped overlap found → 409 with conflicting season details", async () => {
    const conflict = makeDbSeason(); // Spring Exhibition, Jan–May
    mockDb.select.mockReturnValue(mockChain([conflict]));

    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Mid-Year", startDate: "2026-05-15", endDate: "2026-08-31" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overlaps with existing season "Spring Exhibition"/i);
    expect(res.body.error).toContain("2026-01-01");
    expect(res.body.error).toContain("2026-05-31");
    expect(res.body.conflictingSeasonId).toBe(10);
  });

  it("global season (leagueId=null) visible to the league conflicts → 409", async () => {
    const globalConflict = makeDbSeason({ id: 99, leagueId: null, name: "Global Winter" });
    mockDb.select.mockReturnValue(mockChain([globalConflict]));

    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "League Season", startDate: "2026-01-01", endDate: "2026-03-31" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/"Global Winter"/i);
    expect(res.body.conflictingSeasonId).toBe(99);
  });

  it("startDate >= endDate → 400 before DB is ever touched", async () => {
    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Bad Range", startDate: "2026-06-01", endDate: "2026-06-01" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate must be before endDate/i);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("missing name → 400", async () => {
    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ startDate: "2026-06-01", endDate: "2026-08-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  it("invalid date format → 400", async () => {
    const res = await supertest(app)
      .post("/api/leagues/1/seasons")
      .send({ name: "Bad Date", startDate: "06/01/2026", endDate: "2026-08-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route integration tests — PATCH /api/seasons/:id — self-exclusion
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /api/seasons/:id — self-exclusion and overlap", () => {
  it("updating only the name on an existing season → no conflict check triggers → 200", async () => {
    const existing = makeDbSeason({ id: 10 });
    const updated  = makeDbSeason({ id: 10, name: "Spring Exhibition (Renamed)" });
    // First select: fetch existing season; second: findOverlappingSeason returns []
    mockDb.select
      .mockReturnValueOnce(mockChain([existing]))
      .mockReturnValueOnce(mockChain([]));
    mockDb.update.mockReturnValue(mockChain([updated]));

    const res = await supertest(app)
      .patch("/api/seasons/10")
      .send({ name: "Spring Exhibition (Renamed)" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Spring Exhibition (Renamed)");
  });

  it("extending own date range, excludeId removes self from conflict check → 200", async () => {
    const existing = makeDbSeason({ id: 10, startDate: "2026-01-01", endDate: "2026-05-31" });
    const updated  = makeDbSeason({ id: 10, endDate: "2026-06-15" });
    // findOverlappingSeason returns [] because excludeId=10 eliminates the self-match
    mockDb.select
      .mockReturnValueOnce(mockChain([existing]))
      .mockReturnValueOnce(mockChain([]));
    mockDb.update.mockReturnValue(mockChain([updated]));

    const res = await supertest(app)
      .patch("/api/seasons/10")
      .send({ endDate: "2026-06-15" });

    expect(res.status).toBe(200);
    expect(res.body.endDate).toBe("2026-06-15");
  });

  it("changing dates to overlap a different season → 409 with conflict details", async () => {
    const existing    = makeDbSeason({ id: 10, startDate: "2026-01-01", endDate: "2026-05-31" });
    const otherSeason = makeDbSeason({ id: 20, name: "Summer League", startDate: "2026-06-01", endDate: "2026-08-31" });

    mockDb.select
      .mockReturnValueOnce(mockChain([existing]))
      .mockReturnValueOnce(mockChain([otherSeason])); // conflict with Summer League

    const res = await supertest(app)
      .patch("/api/seasons/10")
      .send({ endDate: "2026-07-15" }); // extends into Summer League

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/"Summer League"/i);
    expect(res.body.conflictingSeasonId).toBe(20);
  });

  it("PATCH on a non-existent season → 404", async () => {
    mockDb.select.mockReturnValueOnce(mockChain([]));

    const res = await supertest(app)
      .patch("/api/seasons/999")
      .send({ name: "Ghost Season" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
