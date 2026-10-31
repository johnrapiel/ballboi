import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MessagingService } from "../messaging/service";

const { holder } = vi.hoisted(() => ({ holder: { svc: null as unknown } }));
vi.mock("../messaging", () => ({ getMessagingService: () => holder.svc }));

import { deleteMessagingData } from "../messaging/accountDeletion";

let repo: MemoryMessagingRepo;
let provider: MemoryMessagingProvider;
let svc: MessagingService;

beforeEach(() => {
  repo = new MemoryMessagingRepo();
  provider = new MemoryMessagingProvider();
  svc = new MessagingService({ repo, provider });
  holder.svc = svc;
  repo.names.set("alex", { name: "Alex", playerId: 1 });
  repo.names.set("blair", { name: "Blair", playerId: 2 });
  repo.playerAccounts.set(1, "alex");
  repo.playerAccounts.set(2, "blair");
  repo.createdAt.set("alex", new Date("2026-01-01"));
  repo.connect("alex", "blair");
});

describe("deleteMessagingData", () => {
  it("removes the person's messages and every conversation they're in", async () => {
    const { conversationId, message } = await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: "client-0001" });
    await svc.send("blair", conversationId, { text: "Hey", clientMessageId: "client-0002" });
    await deleteMessagingData("alex", { warn: vi.fn() });
    expect(await provider.getMessage(message.id)).toBeNull();
    expect(repo.conversations).toHaveLength(0);
  });

  it("logs and carries on when the provider fails", async () => {
    await svc.start("alex", { playerId: 2, text: "Hi", clientMessageId: "client-0001" });
    provider.deleteUserData = async () => {
      throw new Error("Stream down");
    };
    const warn = vi.fn();
    await deleteMessagingData("alex", { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(repo.conversations).toHaveLength(0);
  });
});
