import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } }, getAuth: () => ({ userId: null }) }));

import { FirstMessageFilter } from "../messaging/filter";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MemoryModerationRepo } from "../messaging/moderation";
import { SYSTEM_SENDER } from "../messaging/provider";
import { LEFT_BALL_BOI, MessagingError, MessagingService, type GroupSync, type NewMessageEvent } from "../messaging/service";
import { messagePushContent } from "../services/push/messagePush";

// Group chats on the messaging service (F15, John, Nov 8): an open match's
// chat once its last spot fills, with the same safety as direct messages.

let now = new Date("2026-11-08T15:00:00Z");
let repo: MemoryMessagingRepo;
let provider: MemoryMessagingProvider;
let mod: MemoryModerationRepo;
let svc: MessagingService;
let pushed: NewMessageEvent[];
let n = 0;
const mid = () => `msg-${String(++n).padStart(6, "0")}`;

const TITLE = "Sat 9 AM doubles · Beacon Courts";
const fill = (members: string[], extra: Partial<GroupSync> = {}): GroupSync => ({
  openMatchId: 7,
  title: TITLE,
  members,
  open: true,
  create: true,
  system: `All ${members.length} spots filled.`,
  ...extra,
});

beforeEach(() => {
  now = new Date("2026-11-08T15:00:00Z");
  n = 0;
  pushed = [];
  repo = new MemoryMessagingRepo({ now: () => now });
  provider = new MemoryMessagingProvider({ now: () => now });
  mod = new MemoryModerationRepo(() => now);
  svc = new MessagingService({
    repo,
    provider,
    filter: new FirstMessageFilter(["badword"]),
    now: () => now,
    onNewMessage: (e) => void pushed.push(e),
    moderation: { repo: mod },
  });
  for (const [id, pid, uid, name] of [
    ["dana", 1, 11, "Dana Lindqvist"],
    ["theo", 2, 12, "Theo Brandt"],
    ["mia", 3, 13, "Mia Kowalski"],
    ["sam", 4, 14, "Sam Whitfield"],
  ] as const) {
    repo.names.set(id, { name, playerId: pid, userId: uid });
  }
});

async function expectError(p: Promise<unknown>, code: string, status?: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MessagingError);
  expect((err as MessagingError).code).toBe(code);
  if (status) expect((err as MessagingError).status).toBe(status);
}

describe("group channels", () => {
  it("makes one channel with every member and Ball Boi's line", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia", "sam"])))!;
    expect(provider.membersOf(g.channelId).sort()).toEqual(["dana", "mia", "sam", "theo"]);
    const thread = await svc.groupThread("theo", g.id);
    expect(thread.group).toMatchObject({ title: TITLE, memberCount: 4, canSend: true, openMatchId: 7 });
    expect(thread.messages).toEqual([expect.objectContaining({ text: "All 4 spots filled.", senderName: null, fromMe: false })]);
    // Making it again is the same chat.
    const again = await svc.syncGroup(fill(["dana", "theo", "mia", "sam"], { system: undefined }));
    expect(again!.id).toBe(g.id);
    expect(repo.groups).toHaveLength(1);
  });

  it("leaves a missing chat alone unless asked to make it", async () => {
    expect(await svc.syncGroup(fill(["dana", "theo"], { create: false }))).toBeNull();
    expect(repo.groups).toHaveLength(0);
  });

  it("sends to everyone, with unread counts and a push each, and names the sender", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.sendToGroup("theo", g.id, { text: "See you Saturday", clientMessageId: mid() });
    expect(pushed.map((p) => p.recipientId).sort()).toEqual(["dana", "mia"]);
    expect(pushed[0]).toMatchObject({ conversationId: g.id, senderName: "Theo Brandt", groupTitle: TITLE });
    const [list] = await svc.groups("mia");
    expect(list).toMatchObject({ unread: 2, lastMessage: { text: "See you Saturday", senderName: "Theo Brandt", fromMe: false } });
    expect((await svc.summary("mia")).unread).toBe(2);
    const thread = await svc.groupThread("mia", g.id);
    expect(thread.messages.at(-1)).toMatchObject({ senderName: "Theo Brandt", senderPlayerId: 2, senderUserId: 12 });
    expect((await svc.summary("mia")).unread).toBe(0);
    expect((await svc.groups("theo"))[0].unread).toBe(1); // only Ball Boi's line
  });

  it("gives each sender's photo for their messages (John, Nov 11), and none for you or Ball Boi", async () => {
    repo.names.set("theo", { name: "Theo Brandt", playerId: 2, userId: 12, avatarUrl: "/objects/avatars/theo.jpg" });
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.sendToGroup("theo", g.id, { text: "See you Saturday", clientMessageId: mid() });
    await svc.sendToGroup("mia", g.id, { text: "Same", clientMessageId: mid() });
    const thread = await svc.groupThread("mia", g.id);
    expect(thread.messages.map((m) => [m.text, m.senderAvatarUrl])).toEqual([
      ["All 3 spots filled.", null],
      ["See you Saturday", "/objects/avatars/theo.jpg"],
      ["Same", null],
    ]);
  });

  it("never sends twice for a retried client id", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    const id = mid();
    await svc.sendToGroup("theo", g.id, { text: "On my way", clientMessageId: id });
    await svc.sendToGroup("theo", g.id, { text: "On my way", clientMessageId: id });
    expect((await svc.groupThread("dana", g.id)).messages.filter((m) => m.text === "On my way")).toHaveLength(1);
    expect(pushed).toHaveLength(1);
  });

  it("is only for members", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    await expectError(svc.groupThread("sam", g.id), "not_found", 404);
    await expectError(svc.sendToGroup("sam", g.id, { text: "Hi", clientMessageId: mid() }), "not_found", 404);
    expect(await svc.groups("sam")).toEqual([]);
  });

  it("keeps direct messages as they are next to it", async () => {
    repo.playerAccounts.set(2, "theo");
    repo.connect("dana", "theo");
    await svc.syncGroup(fill(["dana", "theo"]));
    const dm = await svc.start("dana", { playerId: 2, text: "Hey", clientMessageId: mid() });
    expect((await svc.list("theo")).map((c) => c.id)).toEqual([dm.conversationId]);
    expect(pushed.at(-1)).not.toHaveProperty("groupTitle");
    expect((await svc.summary("theo")).unread).toBe(2); // the direct message and Ball Boi's line
  });
});

describe("member changes", () => {
  it("takes out a player who drops out, closes the chat while the spot is open, and says so", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.syncGroup({ openMatchId: 7, title: TITLE, members: ["dana", "mia"], open: false, closedReason: "A spot opened again.", system: "Theo dropped out." });
    expect(provider.membersOf(g.channelId).sort()).toEqual(["dana", "mia"]);
    await expectError(svc.groupThread("theo", g.id), "not_found", 404);
    const thread = await svc.groupThread("mia", g.id);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: "A spot opened again.", memberCount: 2 });
    expect(thread.messages.at(-1)?.text).toBe("Theo dropped out.");
    await expectError(svc.sendToGroup("mia", g.id, { text: "Anyone?", clientMessageId: mid() }), "closed", 409);
  });

  it("adds the player who fills it again, who sees the chat so far", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    await svc.sendToGroup("dana", g.id, { text: "Court 3", clientMessageId: mid() });
    await svc.syncGroup({ openMatchId: 7, title: TITLE, members: ["dana"], open: false, system: "Theo dropped out." });
    await svc.syncGroup(fill(["dana", "sam"]));
    expect(provider.membersOf(g.channelId).sort()).toEqual(["dana", "sam"]);
    const thread = await svc.groupThread("sam", g.id);
    expect(thread.group.canSend).toBe(true);
    expect(thread.messages.map((m) => m.text)).toContain("Court 3");
  });

  it("posts a removal line only when someone was really taken out", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    const before = (await svc.groupThread("dana", g.id)).messages.length;
    await svc.syncGroup({ openMatchId: 7, title: TITLE, members: ["dana", "theo"], open: true, system: "Sam is out.", systemOnlyIfRemoved: true });
    expect((await svc.groupThread("dana", g.id)).messages).toHaveLength(before);
    await svc.syncGroup({ openMatchId: 7, title: TITLE, members: ["dana"], open: false, system: "Theo is out.", systemOnlyIfRemoved: true });
    expect((await svc.groupThread("dana", g.id)).messages.at(-1)?.text).toBe("Theo is out.");
  });

  it("keeps everyone in a canceled match's chat, read only", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    await svc.syncGroup({ openMatchId: 7, title: TITLE, members: ["dana", "theo"], open: false, closedReason: "This match was canceled.", system: "Dana canceled this match." });
    const thread = await svc.groupThread("theo", g.id);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: "This match was canceled." });
    expect(thread.messages.at(-1)?.text).toBe("Dana canceled this match.");
  });

  it("takes a deleted account out of every group chat", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.sendToGroup("theo", g.id, { text: "Hi all", clientMessageId: mid() });
    await svc.deleteUserData("theo");
    expect(provider.membersOf(g.channelId).sort()).toEqual(["dana", "mia"]);
    expect(await svc.groups("theo")).toEqual([]);
    const dana = await svc.groupThread("dana", g.id);
    expect(dana.messages.map((m) => m.text)).not.toContain("Hi all");
    expect(dana.messages.at(-1)?.text).toBe("A player left Ball Boi.");
    expect(dana.group).toMatchObject({ canSend: false, sendBlockedReason: LEFT_BALL_BOI });
  });
});

describe("first-message filter, per sender", () => {
  it("filters a sender's first message when anyone in the chat is outside their leagues", async () => {
    repo.connect("theo", "dana");
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await expectError(svc.sendToGroup("theo", g.id, { text: "text me at 845-555-1234", clientMessageId: mid() }), "filtered_phone", 422);
    await expectError(svc.sendToGroup("theo", g.id, { text: "go to example.com", clientMessageId: mid() }), "filtered_link", 422);
    await expectError(svc.sendToGroup("theo", g.id, { text: "badword", clientMessageId: mid() }), "filtered_blocked_term", 422);
    await svc.sendToGroup("theo", g.id, { text: "Hi all", clientMessageId: mid() });
    // Only the first message: after that, like direct messages, it's a conversation.
    await svc.sendToGroup("theo", g.id, { text: "text me at 845-555-1234", clientMessageId: mid() });
  });

  it("lets a sender through who shares a league with everyone in it", async () => {
    repo.connect("theo", "dana");
    repo.connect("theo", "mia");
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.sendToGroup("theo", g.id, { text: "my email is theo@example.com", clientMessageId: mid() });
    // Mia is outside Dana's leagues, so Dana's first message is still checked.
    await expectError(svc.sendToGroup("dana", g.id, { text: "dana@example.com", clientMessageId: mid() }), "filtered_email", 422);
  });

  it("doesn't count the chat's own match as a connection", async () => {
    repo.connect("theo", "dana");
    repo.openMatchOnly.add(["theo", "dana"].sort().join(":"));
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    await expectError(svc.sendToGroup("theo", g.id, { text: "845-555-1234", clientMessageId: mid() }), "filtered_phone", 422);
  });
});

describe("blocks inside a group chat", () => {
  it("leaves out messages, unread counts and pushes between players with a block, either way", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    repo.blocks = [["mia", "theo"]];
    await svc.sendToGroup("theo", g.id, { text: "From Theo", clientMessageId: mid() });
    expect(pushed.map((p) => p.recipientId)).toEqual(["dana"]);
    const mia = await svc.groupThread("mia", g.id);
    expect(mia.messages.map((m) => m.text)).not.toContain("From Theo");
    expect(mia.group.lastMessage?.text).toBe("All 3 spots filled.");
    expect((await svc.groupThread("dana", g.id)).messages.map((m) => m.text)).toContain("From Theo");
  });
});

describe("reports and Stream moderation", () => {
  it("reports a group message with a server snapshot of the chat", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo", "mia"])))!;
    await svc.sendToGroup("dana", g.id, { text: "Who brings balls?", clientMessageId: mid() });
    const { message } = await svc.sendToGroup("theo", g.id, { text: "Something nasty", clientMessageId: mid() });
    const { id } = await svc.reportGroupMessage("mia", g.id, { messageId: message.id, reason: "harassment", details: "" });
    const report = mod.reports.find((r) => r.id === id)!;
    expect(report).toMatchObject({ reporter: "mia", subject: "theo", targetId: message.id, source: "user" });
    expect(report.snapshot?.conversationId).toBeNull();
    expect(report.snapshot?.messages.map((m) => [m.senderName, m.text, m.reported])).toEqual([
      ["Ball Boi", "All 3 spots filled.", false],
      ["Dana Lindqvist", "Who brings balls?", false],
      ["Theo Brandt", "Something nasty", true],
    ]);
  });

  it("won't report your own message, Ball Boi's lines, or a chat you're not in", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    const { message } = await svc.sendToGroup("theo", g.id, { text: "Hi", clientMessageId: mid() });
    await expectError(svc.reportGroupMessage("theo", g.id, { messageId: message.id, reason: "spam", details: "" }), "own_message", 400);
    const system = (await provider.listMessages(g.channelId)).find((m) => m.senderId === SYSTEM_SENDER)!;
    await expectError(svc.reportGroupMessage("dana", g.id, { messageId: system.id, reason: "spam", details: "" }), "message_not_found", 404);
    await expectError(svc.reportGroupMessage("sam", g.id, { messageId: message.id, reason: "spam", details: "" }), "not_found", 404);
  });

  it("files a Stream flag on a group message into the same queue", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    const { message } = await svc.sendToGroup("theo", g.id, { text: "Flagged", clientMessageId: mid() });
    const id = await svc.recordProviderFlag({ messageId: message.id, details: "toxic", reason: "harassment" });
    expect(mod.reports.find((r) => r.id === id)).toMatchObject({ source: "stream", subject: "theo", reporter: null });
  });

  it("hides a message for everyone and keeps the Messages preview in step", async () => {
    const g = (await svc.syncGroup(fill(["dana", "theo"])))!;
    const { message } = await svc.sendToGroup("theo", g.id, { text: "Hidden soon", clientMessageId: mid() });
    await svc.setMessageHidden(message.id, true);
    expect((await svc.groupThread("dana", g.id)).messages.map((m) => m.text)).not.toContain("Hidden soon");
    expect((await svc.groups("dana"))[0].lastMessage).toMatchObject({ text: "All 2 spots filled.", senderName: null });
  });
});

describe("group message push", () => {
  it("names the chat and opens it, and honors Show message previews", () => {
    const e = { conversationId: 5, senderName: "Theo Brandt", text: "See you Saturday", groupTitle: TITLE };
    expect(messagePushContent(e, true)).toEqual({ title: `Theo Brandt in ${TITLE}`, body: "See you Saturday", link: "/conversation/group/5" });
    expect(messagePushContent(e, false)).toEqual({ title: "", body: `New message from Theo Brandt in ${TITLE}`, link: "/conversation/group/5" });
  });
});

describe("doubles match chats (D6, John, Nov 9)", () => {
  const sync = (extra: Record<string, unknown> = {}) =>
    svc.syncMatchGroup({
      matchId: 41,
      title: "Doubles · Week 3",
      titles: { dana: "You, Theo, Mia and Sam · Week 3", theo: "You, Dana, Mia and Sam · Week 3", mia: "You, Sam, Dana and Theo · Week 3", sam: "You, Mia, Dana and Theo · Week 3" },
      members: ["dana", "theo", "mia", "sam"],
      open: true,
      create: true,
      system: "Week 3 pairings are out. Work out a time here.",
      ...extra,
    });

  it("opens one chat for all four, titled for each of them, listed in Messages", async () => {
    const g = (await sync())!;
    expect(await svc.groupForMatch(41)).toMatchObject({ id: g.id });
    const [dana] = await svc.groups("dana");
    expect(dana).toMatchObject({ kind: "doubles", matchId: 41, title: "You, Theo, Mia and Sam · Week 3", memberCount: 4, canSend: true });
    expect((await svc.groups("mia"))[0].title).toBe("You, Sam, Dana and Theo · Week 3");
    // Every member's message reaches the other three.
    await svc.sendToGroup("dana", g.id, { text: "Thursday 6pm?", clientMessageId: mid() });
    expect(pushed.map((p) => p.recipientId).sort()).toEqual(["mia", "sam", "theo"]);
  });

  it("holds Ball Boi's cards and goes read only once the score is in", async () => {
    const g = (await sync())!;
    await svc.postToMatch(41, "Still on for tomorrow at 6:00 PM? Say here if anything changes.");
    await sync({ open: false, closedReason: "The score is in, so this chat is read only.", system: "Dana L. & Theo B. def. Mia K. & Sam W. 6-3, 6-4", create: false });
    const thread = await svc.groupThread("sam", g.id);
    expect(thread.messages.map((m) => m.text)).toEqual([
      "Week 3 pairings are out. Work out a time here.",
      "Still on for tomorrow at 6:00 PM? Say here if anything changes.",
      "Dana L. & Theo B. def. Mia K. & Sam W. 6-3, 6-4",
    ]);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: "The score is in, so this chat is read only." });
    await expect(svc.sendToGroup("sam", g.id, { text: "gg", clientMessageId: mid() })).rejects.toBeInstanceOf(MessagingError);
  });

  it("isn't made without create, and drops a member who's no longer in the match", async () => {
    expect(await sync({ create: false })).toBeNull();
    const g = (await sync())!;
    await sync({ members: ["dana", "theo", "mia"], create: false, system: undefined });
    await expect(svc.groupThread("sam", g.id)).rejects.toBeInstanceOf(MessagingError);
  });
});
