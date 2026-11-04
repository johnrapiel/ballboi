import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// The API contract (A20, C22, D29, B20): lib/api-spec/openapi.yaml lists every
// route the mobile app calls, each route it lists exists on the server, and the
// bodies the server sends fit the generated schemas.

let mockUserId: string | null = "alex";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {}, ObjectNotFoundError: class extends Error {} }));
vi.mock("../lib/objectStorage.js", () => ({ ObjectStorageService: class {}, ObjectNotFoundError: class extends Error {} }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const db = {
    select: () => {
      throw new Error("No database in this test");
    },
  };
  return { ...actual, db };
});

import * as zod from "@workspace/api-zod";
import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingService } from "../messaging/service";
import { MemorySanctionsRepo, SanctionsService, type AccountIdentity } from "../messaging/sanctions";
import { createMessagesRouter } from "../routes/messages";
import { createSanctionsRouter } from "../routes/sanctions";

const ROOT = path.resolve(__dirname, "../../../..");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** "/leagues/{leagueId}" and "/leagues/:leagueId" both become "/leagues/{}". */
const normalize = (p: string) =>
  p
    .replace(/\{[^}]+\}/g, "{}")
    .replace(/:\w+/g, "{}")
    .replace(/\*\w+/g, "{}");

/** Operations in openapi.yaml, read straight from the file: "get /leagues/{}". */
function specOperations(): Set<string> {
  const text = readFileSync(path.join(ROOT, "lib/api-spec/openapi.yaml"), "utf8");
  const ops = new Set<string>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("components:")) break;
    const p = line.match(/^ {2}(\/\S*):\s*$/);
    if (p) current = p[1];
    const m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (m && current) ops.add(`${m[1]} ${normalize(current)}`);
  }
  return ops;
}

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

/** Routes the real API router answers, walked from Express's own route table. */
async function serverOperations(): Promise<Set<string>> {
  const { default: router } = await import("../routes/index.js");
  const ops = new Set<string>();
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) for (const m of METHODS) if (layer.route.methods[m]) ops.add(`${m} ${normalize(p)}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack);
  return ops;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** The method a call near this text uses: method: "POST", a helper's "PUT" argument, or post(…). */
function methodIn(text: string): string | null {
  return (
    text.match(/method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/)?.[1] ??
    text.match(/^[^)]*?["'](GET|POST|PUT|PATCH|DELETE)["']/)?.[1] ??
    (/^[^;]*?\bpost\(/.test(text) ? "POST" : null)
  );
}

/**
 * Every "/api/..." address in the app's own code (calls outside the generated
 * client), with the method found next to it: method: "POST", or the helper's
 * "PUT" argument. A bare address is a GET.
 */
function mobileCalls(): { op: string; file: string; prefix: boolean }[] {
  const out: { op: string; file: string; prefix: boolean }[] = [];
  for (const file of sourceFiles(path.join(ROOT, "artifacts/mobile"))) {
    const text = readFileSync(file, "utf8");
    const re = /["'`](?:\$\{API_BASE\})?\/api(\/[^"'`\s]*)["'`]/g;
    for (const m of text.matchAll(re)) {
      let address = m[1].split("?")[0];
      // "/api/storage${path}" and "/api/storage/objects/" are the start of an address.
      const prefix = address.endsWith("/") || /[^/]\$\{[^}]+\}$/.test(address);
      if (prefix) address = address.replace(/\$\{[^}]+\}$/, "");
      address = address.replace(/\$\{[^}]+\}/g, "{}");
      const end = m.index! + m[0].length;
      let method = methodIn(text.slice(end, end + 250).split(/\/api\//)[0].split(";")[0]);
      // `const path = cond ? "/api/a" : "/api/b"; apiFetch(path, …, { method })`
      const assigned = text.slice(Math.max(0, m.index! - 200), m.index!).match(/const (\w+) =[^;]*$/);
      if (!method && assigned) {
        const use = text.slice(end).search(new RegExp(`\\(${assigned[1]}\\b`));
        if (use >= 0) method = methodIn(text.slice(end + use, end + use + 250));
      }
      out.push({ op: `${(method ?? "GET").toLowerCase()} ${normalize(address)}`, file: path.relative(ROOT, file), prefix });
    }
  }
  return out;
}

describe("API contract: routes", () => {
  it("every operation in openapi.yaml exists on the server", async () => {
    const server = await serverOperations();
    const missing = [...specOperations()].filter((op) => !server.has(op));
    expect(missing).toEqual([]);
  });

  it("the generated client has every operation in openapi.yaml (regenerated after the last spec change)", () => {
    const spec = readFileSync(path.join(ROOT, "lib/api-spec/openapi.yaml"), "utf8");
    const client = readFileSync(path.join(ROOT, "lib/api-client-react/src/generated/api.ts"), "utf8");
    const ids = [...spec.matchAll(/^ {6}operationId: (\w+)\s*$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(100);
    expect(ids.filter((id) => !client.includes(`export const ${id} = async (`))).toEqual([]);
  });

  it("finds the app's own API calls", () => {
    expect(mobileCalls().length).toBeGreaterThan(40);
  });

  it("every address the app calls is in openapi.yaml with its method, and on the server", async () => {
    const spec = specOperations();
    const server = await serverOperations();
    const problems: string[] = [];
    for (const call of mobileCalls()) {
      if (call.prefix) {
        const [method, start] = call.op.split(" ");
        const inSpec = [...spec].some((op) => op.startsWith(`${method} ${start}`));
        const onServer = [...server].some((op) => op.startsWith(`${method} ${start}`));
        if (!inSpec || !onServer) problems.push(`${call.op}… (${call.file})`);
      } else if (!spec.has(call.op) || !server.has(call.op)) {
        problems.push(`${call.op} (${call.file}) spec=${spec.has(call.op)} server=${server.has(call.op)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// ─── Response bodies against the generated schemas ─────────────────────────

let repo: MemoryMessagingRepo;
let messaging: MessagingService;
let sanctionsRepo: MemorySanctionsRepo;
let sanctions: SanctionsService;

const bad: AccountIdentity = { clerkUserId: "user_bad", appleUserId: null, emails: ["bad@example.com"] };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", createMessagesRouter(() => messaging));
  a.use(
    "/api",
    createSanctionsRouter({
      getService: () => sanctions,
      getIdentity: async (id) => (id === "user_bad" ? bad : { clerkUserId: id, appleUserId: null, emails: [] }),
      admin: (_req, _res, next) => next(),
      onChange: () => undefined,
      isAdmin: async (id) => id === "user_admin",
      getNames: async (ids) => new Map(ids.map((id) => [id, "Bad Actor"])),
    }),
  );
  return supertest(a);
}

/** The body fits the generated schema. */
function fits(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, body: unknown) {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(`Doesn't fit: ${JSON.stringify(body)}\n${String(r.error)}`);
}

/** Sanction's required fields in openapi.yaml. */
const sanctionShape = (kind: "ban" | "suspend") => ({
  id: expect.any(Number),
  kind,
  clerkUserId: expect.any(String),
  reason: expect.any(String),
  endsAt: kind === "ban" ? null : expect.any(String),
  createdAt: expect.any(String),
  liftedAt: null,
});

beforeEach(() => {
  mockUserId = "alex";
  repo = new MemoryMessagingRepo();
  messaging = new MessagingService({ repo, provider: new MemoryMessagingProvider(), filter: new FirstMessageFilter() });
  repo.names.set("alex", { name: "Alex Kim", playerId: 1 });
  repo.names.set("casey", { name: "Casey Fox", playerId: 3 });
  repo.playerAccounts.set(1, "alex");
  repo.playerAccounts.set(3, "casey");
  repo.createdAt.set("alex", new Date("2026-01-01"));
  repo.connect("alex", "casey");
  sanctionsRepo = new MemorySanctionsRepo();
  sanctions = new SanctionsService(sanctionsRepo, async () => 901);
});

describe("API contract: messages", () => {
  it("conversation bodies fit the generated schemas", async () => {
    const start = await app().post("/api/messages").send({ playerId: 3, text: "Up for a hit?", clientMessageId: "client-0001" });
    expect(start.status).toBe(201);
    // Orval makes schemas for 200 bodies only; 201 bodies are checked against the spec's shape here.
    const sent = { conversationId: expect.any(Number), message: { id: expect.any(String), text: expect.any(String), fromMe: true, at: expect.any(String) } };
    expect(start.body).toEqual(sent);
    const id = start.body.conversationId as number;

    const send = await app().post(`/api/messages/${id}/messages`).send({ text: "Saturday?", clientMessageId: "client-0002" });
    expect(send.status).toBe(201);
    expect(send.body).toEqual(sent);

    const list = await app().get("/api/messages");
    expect(list.body.conversations).toHaveLength(1);
    fits(zod.GetConversationsResponse, list.body);
    fits(zod.GetMessagesSummaryResponse, (await app().get("/api/messages/summary")).body);
    fits(zod.GetMessageContactsResponse, (await app().get("/api/messages/contacts")).body);
    fits(zod.GetConversationWithPlayerResponse, (await app().get("/api/messages/with-player/3")).body);
    fits(zod.GetConversationWithPlayerResponse, (await app().get("/api/messages/with-player/99")).body);

    const thread = await app().get(`/api/messages/${id}`);
    expect(thread.body.messages).toHaveLength(2);
    fits(zod.GetConversationResponse, thread.body);
  });

  it("errors carry a message and a code", async () => {
    const res = await app().get("/api/messages/999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String), code: "not_found" });
  });
});

describe("API contract: account status, bans and appeals", () => {
  it("bodies fit the generated schemas", async () => {
    mockUserId = "user_bad";
    fits(zod.GetAccountStatusResponse, (await app().get("/api/account/status")).body);

    mockUserId = "user_admin";
    fits(zod.GetAdminMeResponse, (await app().get("/api/admin/me")).body);
    const ban = await app().post("/api/admin/accounts/user_bad/suspend").send({ reason: "Spam", days: 7 });
    expect(ban.status).toBe(201);
    expect(ban.body).toEqual({ sanction: expect.objectContaining(sanctionShape("suspend")) });

    mockUserId = "user_bad";
    const status = await app().get("/api/account/status");
    expect(status.body.status).toBe("suspended");
    fits(zod.GetAccountStatusResponse, status.body);
    const appeal = await app().post("/api/account/appeal");
    expect(appeal.status).toBe(201);
    expect(appeal.body).toEqual({ reference: expect.stringMatching(/^BB-\d{5}$/), supportEmail: expect.any(String) });
    fits(zod.GetAccountStatusResponse, (await app().get("/api/account/status")).body);
    const again = await app().post("/api/account/appeal");
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: expect.any(String), code: "already_appealed" });

    mockUserId = "user_admin";
    const appeals = await app().get("/api/admin/appeals");
    expect(appeals.body).toHaveLength(1);
    fits(zod.GetAppealsResponse, appeals.body);
    const decided = await app().post(`/api/admin/appeals/${appeals.body[0].id}/decide`).send({ outcome: "upheld" });
    expect(decided.status).toBe(200);
    fits(zod.DecideAppealResponse, decided.body);

    const banned = await app().post("/api/admin/accounts/user_other/ban").send({ reason: "Threats" });
    expect(banned.status).toBe(201);
    expect(banned.body).toEqual({ sanction: expect.objectContaining(sanctionShape("ban")) });
  });
});
