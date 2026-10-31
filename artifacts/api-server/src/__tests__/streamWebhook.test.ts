import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request } from "express";
import supertest from "supertest";
import { createHmac } from "node:crypto";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { AutoRestrict, MemoryModerationRepo } from "../messaging/moderation";
import { MessagingService } from "../messaging/service";
import { createStreamWebhookRouter, parseFlagEvent, reasonForLabels } from "../routes/streamWebhook";

const SECRET = "whsec";
let svc: MessagingService;
let mod: MemoryModerationRepo;
let messageId: string;

function app() {
  const a = express();
  a.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  a.use("/api", createStreamWebhookRouter(() => svc, () => SECRET));
  return a;
}

function post(body: object, opts: { secret?: string; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", opts.secret ?? SECRET).update(raw).digest("hex");
  return supertest(app())
    .post("/api/webhooks/stream")
    .set("Content-Type", "application/json")
    .set("X-Signature", sig)
    .set("X-Webhook-Id", opts.id ?? `wh-${Math.random()}`)
    .send(raw);
}

const flagEvent = (id: string) => ({
  type: "review_queue_item.new",
  review_queue_item: {
    entity_type: "stream:chat:v1:message",
    entity_id: id,
    entity_creator_id: "bad",
    recommended_action: "flag",
    flags: [{ labels: ["HARASSMENT", "INSULT"], reason: "ai_text" }],
  },
});

beforeEach(async () => {
  const repo = new MemoryMessagingRepo();
  mod = new MemoryModerationRepo();
  repo.restrictedSet = (ids) => mod.restrictedSet(ids);
  repo.names.set("bad", { name: "Bad Actor", playerId: 1 });
  repo.playerAccounts.set(2, "good");
  repo.createdAt.set("bad", new Date("2026-01-01"));
  svc = new MessagingService({
    repo,
    provider: new MemoryMessagingProvider(),
    filter: new FirstMessageFilter(),
    moderation: { auto: new AutoRestrict(mod), repo: mod },
  });
  const sent = await svc.start("bad", { playerId: 2, text: "you're awful", clientMessageId: "client-0001" });
  messageId = sent.message.id;
});

describe("Stream moderation webhook", () => {
  it("refuses unsigned or mis-signed events", async () => {
    expect((await post(flagEvent(messageId), { secret: "wrong" })).status).toBe(401);
    expect(mod.reports).toHaveLength(0);
  });

  it("files a message report with a snapshot and restricts the sender", async () => {
    const res = await post(flagEvent(messageId));
    expect(res.status).toBe(200);
    expect(mod.reports).toHaveLength(1);
    expect(mod.reports[0]).toMatchObject({
      source: "stream",
      targetType: "message",
      targetId: messageId,
      subject: "bad",
      reporter: null,
      reason: "harassment",
      details: "Flagged · HARASSMENT · INSULT · ai_text",
    });
    expect(mod.reports[0].snapshot?.messages[0]).toMatchObject({ text: "you're awful", reported: true, senderName: "Bad Actor" });
    expect(await mod.restrictedSet(["bad"])).toEqual(new Set(["bad"]));
  });

  it("handles a retried event once", async () => {
    await post(flagEvent(messageId), { id: "same" });
    await post(flagEvent(messageId), { id: "same" });
    expect(mod.reports).toHaveLength(1);
  });

  it("ignores other events and messages that aren't ours", async () => {
    expect((await post({ type: "message.new", message: { id: messageId } })).status).toBe(200);
    expect((await post(flagEvent("someone-elses"))).status).toBe(200);
    expect(mod.reports).toHaveLength(0);
  });
});

describe("parsing", () => {
  it("skips items Stream would keep, and non-message entities", () => {
    const keep = flagEvent("m");
    keep.review_queue_item.recommended_action = "keep";
    expect(parseFlagEvent(keep)).toBeNull();
    const user = flagEvent("m");
    user.review_queue_item.entity_type = "stream:user";
    expect(parseFlagEvent(user)).toBeNull();
    expect(parseFlagEvent({ type: "message.flagged", message: { id: "m2" } })).toEqual({ messageId: "m2", labels: [], action: null });
  });

  it("maps labels to report reasons", () => {
    expect(reasonForLabels(["SPAM"])).toBe("spam");
    expect(reasonForLabels(["sexual_harassment"])).toBe("inappropriate_content");
    expect(reasonForLabels(["THREAT"])).toBe("harassment");
  });
});
