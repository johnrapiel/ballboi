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
  it("send the other person's photo in Messages, and none once you block them", async () => {
    repo.names.set("casey", { name: "Casey Fox", playerId: 3, avatarUrl: "/objects/uploads/casey" });
    const start = await supertest(app()).post("/api/messages").send({ playerId: 3, text: "Up for a hit?", clientMessageId: "client-0101" });
    expect(start.status).toBe(201);
    const inbox = await supertest(app()).get("/api/messages");
    expect(inbox.body.conversations[0].other).toMatchObject({ name: "Casey Fox", avatarUrl: "/objects/uploads/casey" });
    const thread = await supertest(app()).get(`/api/messages/${start.body.conversationId}`);
    expect(thread.body.conversation.other.avatarUrl).toBe("/objects/uploads/casey");

    // Alex has no photo: Casey sees initials.
    mockUserId = "casey";
    expect((await supertest(app()).get("/api/messages")).body.conversations[0].other.avatarUrl).toBeNull();

    // Alex blocks Casey: the chat stays, read only, with no photo.
    mockUserId = "alex";
    repo.blocks.push(["alex", "casey"]);
    const blocked = await supertest(app()).get("/api/messages");
    expect(blocked.body.conversations[0]).toMatchObject({ blocked: true, other: { avatarUrl: null } });
  });

  it("require sign-in", async () => {
    mockUserId = null;
    expect((await supertest(app()).get("/api/messages")).status).toBe(401);
    expect((await supertest(app()).post("/api/messages").send({})).status).toBe(401);
  });

  it("send a first message straight to the inbox, with no Message Requests (finding 17)", async () => {
    const start = await supertest(app())
      .post("/api/messages")
      .send({ playerId: 3, text: "Up for a hit?", clientMessageId: "client-0001" });
    expect(start.status).toBe(201);
    expect(start.body.message).toMatchObject({ text: "Up for a hit?", fromMe: true });
    const id = start.body.conversationId as number;

    const mine = await supertest(app()).get("/api/messages");
    expect(mine.body.conversations[0]).toMatchObject({ id, state: "active", canSend: true, blocked: false });
    expect(mine.body).not.toHaveProperty("requests");

    // The sender can keep sending without waiting for a reply.
    const again = await supertest(app()).post(`/api/messages/${id}/messages`).send({ text: "Hello?", clientMessageId: "client-0002" });
    expect(again.status).toBe(201);

    mockUserId = "casey";
    // An older app asking for the requests box gets the one inbox.
    const inbox = await supertest(app()).get("/api/messages?box=requests");
    expect(inbox.body).toMatchObject({ unread: 2 });
    expect(inbox.body.conversations[0]).toMatchObject({ id, state: "active", other: { name: "Alex Kim", playerId: 1 } });

    const thread = await supertest(app()).get(`/api/messages/${id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages).toHaveLength(2);
    expect(thread.body.olderCursor).toBeNull();
    expect((await supertest(app()).get("/api/messages/summary")).body).toEqual({ unread: 0 });

    const reply = await supertest(app()).post(`/api/messages/${id}/messages`).send({ text: "Sure", clientMessageId: "client-0003" });
    expect(reply.status).toBe(201);
  });

  it("return the filter's plain-language reason", async () => {
    const res = await supertest(app())
      .post("/api/messages")
      .send({ playerId: 3, text: "text me 555-123-4567", clientMessageId: "client-0001" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("filtered_phone");
    expect(res.body.error).toMatch(/phone numbers/);
  });

  it("no longer have a way to delete a request", async () => {
    const start = await supertest(app()).post("/api/messages").send({ playerId: 3, text: "Hi", clientMessageId: "client-0001" });
    mockUserId = "casey";
    expect((await supertest(app()).post(`/api/messages/${start.body.conversationId}/decline`)).status).toBe(404);
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

describe("group chat routes (F15)", () => {
  it("list group chats beside conversations, open, send and report through the same service", async () => {
    const g = (await svc.syncGroup({ openMatchId: 4, title: "Sat 9 AM singles", members: ["alex", "casey"], open: true, create: true, system: "All 2 spots filled." }))!;
    mockUserId = "casey";
    const sent = await supertest(app()).post(`/api/messages/groups/${g.id}/messages`).send({ text: "Court 2?", clientMessageId: "client-0101" });
    expect(sent.status).toBe(201);
    mockUserId = "alex";
    const list = await supertest(app()).get("/api/messages");
    expect(list.body.conversations).toEqual([]);
    expect(list.body.groups[0]).toMatchObject({ id: g.id, title: "Sat 9 AM singles", unread: 2, memberCount: 2 });
    expect(list.body.unread).toBe(2);
    const thread = await supertest(app()).get(`/api/messages/groups/${g.id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages.map((m: { text: string }) => m.text)).toEqual(["All 2 spots filled.", "Court 2?"]);
    // No moderation storage in this test service: the route still answers in plain words.
    const report = await supertest(app()).post(`/api/messages/groups/${g.id}/report`).send({ messageId: sent.body.message.id, reason: "spam" });
    expect(report.status).toBe(503);
    mockUserId = "sam";
    expect((await supertest(app()).get(`/api/messages/groups/${g.id}`)).status).toBe(404);
  });
});
