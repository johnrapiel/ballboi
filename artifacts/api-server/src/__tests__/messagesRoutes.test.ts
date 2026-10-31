import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "alex";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingService } from "../messaging/service";
import { createMessagesRouter } from "../routes/messages";

let repo: MemoryMessagingRepo;
let svc: MessagingService;

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", createMessagesRouter(() => svc));
  return a;
}

beforeEach(() => {
  mockUserId = "alex";
  repo = new MemoryMessagingRepo();
  svc = new MessagingService({ repo, provider: new MemoryMessagingProvider(), filter: new FirstMessageFilter() });
  repo.names.set("alex", { name: "Alex Kim", playerId: 1 });
  repo.names.set("casey", { name: "Casey Fox", playerId: 3 });
  repo.playerAccounts.set(1, "alex");
  repo.playerAccounts.set(3, "casey");
  repo.createdAt.set("alex", new Date("2026-01-01"));
});

describe("messages routes", () => {
  it("require sign-in", async () => {
    mockUserId = null;
    expect((await supertest(app()).get("/api/messages")).status).toBe(401);
    expect((await supertest(app()).post("/api/messages").send({})).status).toBe(401);
  });

  it("start a request, list it on both sides, and accept it with a reply", async () => {
    const start = await supertest(app())
      .post("/api/messages")
      .send({ playerId: 3, text: "Up for a hit?", clientMessageId: "client-0001" });
    expect(start.status).toBe(201);
    expect(start.body.message).toMatchObject({ text: "Up for a hit?", fromMe: true });
    const id = start.body.conversationId as number;

    const mine = await supertest(app()).get("/api/messages");
    expect(mine.body.conversations[0]).toMatchObject({ id, state: "awaiting_reply", canSend: false });

    const blocked = await supertest(app()).post(`/api/messages/${id}/messages`).send({ text: "Hello?", clientMessageId: "client-0002" });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: "You can send more once Casey Fox replies.", code: "awaiting_reply" });

    mockUserId = "casey";
    const requests = await supertest(app()).get("/api/messages?box=requests");
    expect(requests.body).toMatchObject({ requests: 1, unread: 0 });
    expect(requests.body.conversations[0]).toMatchObject({ id, state: "request", other: { name: "Alex Kim", playerId: 1 } });

    const thread = await supertest(app()).get(`/api/messages/${id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages).toHaveLength(1);

    const reply = await supertest(app()).post(`/api/messages/${id}/messages`).send({ text: "Sure", clientMessageId: "client-0003" });
    expect(reply.status).toBe(201);
    expect((await supertest(app()).get("/api/messages/summary")).body).toEqual({ unread: 0, requests: 0 });
  });

  it("return the filter's plain-language reason", async () => {
    const res = await supertest(app())
      .post("/api/messages")
      .send({ playerId: 3, text: "text me 555-123-4567", clientMessageId: "client-0001" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("filtered_phone");
    expect(res.body.error).toMatch(/phone numbers/);
  });

  it("let the recipient delete a request", async () => {
    const start = await supertest(app()).post("/api/messages").send({ playerId: 3, text: "Hi", clientMessageId: "client-0001" });
    mockUserId = "casey";
    expect((await supertest(app()).post(`/api/messages/${start.body.conversationId}/decline`)).status).toBe(204);
    expect((await supertest(app()).get("/api/messages?box=requests")).body.conversations).toEqual([]);
  });

  it("hide conversations you're not in", async () => {
    const start = await supertest(app()).post("/api/messages").send({ playerId: 3, text: "Hi", clientMessageId: "client-0001" });
    mockUserId = "stranger";
    expect((await supertest(app()).get(`/api/messages/${start.body.conversationId}`)).status).toBe(404);
    expect((await supertest(app()).get(`/api/messages/abc`)).status).toBe(404);
  });

  it("only seed samples in development with the in-memory provider", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect((await supertest(app()).post("/api/dev/messages/samples")).status).toBe(404);
    process.env.NODE_ENV = prev;
  });
});
