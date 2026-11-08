import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import supertest from "supertest";

let mockUserId: string | null = "sam";
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  getAuth: () => ({ userId: mockUserId }),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import * as zod from "@workspace/api-zod";
import { FirstMessageFilter } from "../messaging/filter";
import { leagueChat, setLeagueChatEvents } from "../messaging/leagueChatEvents";
import { LeagueChats, type LeagueChatMember, type LeagueChatResult, type LeagueChatSource } from "../messaging/leagueChats";
import { MemoryMessagingProvider } from "../messaging/memoryProvider";
import { MemoryMessagingRepo } from "../messaging/memoryRepo";
import { MemoryModerationRepo } from "../messaging/moderation";
import { LEAGUE_ENDED, MAX_PINS, MUTED_REASON, MessagingError, MessagingService, type NewMessageEvent } from "../messaging/service";
import { createMessagesRouter } from "../routes/messages";
import type { StandingRow } from "../lib/leagueChatPosts";
import { messagePushContent } from "../services/push/messagePush";

// League chat in Messages (Wave 2, decisions 145 and 146): one chat per
// league on the messaging service, kept in step with the league.

/** A league as LeagueChats sees it, in memory. */
class MemoryLeagueSource implements LeagueChatSource {
  leagues = new Map<number, { id: number; name: string; ended: boolean }>();
  roster = new Map<number, LeagueChatMember[]>();
  results = new Map<number, LeagueChatResult>();
  table: StandingRow[] = [];
  async members(id: number) {
    return this.roster.get(id) ?? [];
  }
  async league(id: number) {
    return this.leagues.get(id) ?? null;
  }
  async allLeagueIds() {
    return [...this.leagues.keys()];
  }
  async result(_leagueId: number, matchId: number) {
    return this.results.get(matchId) ?? null;
  }
  async standings() {
    return this.table;
  }
  join(leagueId: number, userId: string, playerId: number | null, admin = false) {
    this.roster.set(leagueId, [...(this.roster.get(leagueId) ?? []).filter((m) => m.userId !== userId), { userId, admin, playerId }]);
  }
  leave(leagueId: number, userId: string) {
    this.roster.set(leagueId, (this.roster.get(leagueId) ?? []).filter((m) => m.userId !== userId));
  }
}

let now = new Date("2026-11-08T15:00:00Z");
let repo: MemoryMessagingRepo;
let provider: MemoryMessagingProvider;
let mod: MemoryModerationRepo;
let svc: MessagingService;
let source: MemoryLeagueSource;
let chats: LeagueChats;
let pushed: NewMessageEvent[];
let n = 0;
const mid = () => `msg-${String(++n).padStart(6, "0")}`;

const LEAGUE = "Spring Ladder";

beforeEach(() => {
  now = new Date("2026-11-08T15:00:00Z");
  n = 0;
  pushed = [];
  repo = new MemoryMessagingRepo({ now: () => now });
  provider = new MemoryMessagingProvider({ now: () => now });
  mod = new MemoryModerationRepo(() => now);
  source = new MemoryLeagueSource();
  svc = new MessagingService({
    repo,
    provider,
    filter: new FirstMessageFilter(["badword"]),
    now: () => now,
    onNewMessage: (e) => void pushed.push(e),
    moderation: { repo: mod },
    leaguePlayers: (leagueId) => chats.leaguePlayers(leagueId),
  });
  chats = new LeagueChats({ service: () => svc, source, log: { warn: vi.fn() } });
  for (const [id, pid, uid, name] of [
    ["john", 1, 11, "John Rapiel"],
    ["sam", 2, 12, "Sam Patel"],
    ["ana", 3, 13, "Ana Ruiz"],
    ["lee", 4, 14, "Lee Chen"],
    ["samuel", 5, 15, "Sam"],
  ] as const) {
    repo.names.set(id, { name, playerId: pid, userId: uid });
    repo.playerAccounts.set(pid, id);
    repo.userAccounts.set(uid, id);
  }
  for (const a of ["john", "sam", "ana", "lee", "samuel"]) for (const b of ["john", "sam", "ana", "lee", "samuel"]) if (a < b) repo.connect(a, b);
  source.leagues.set(1, { id: 1, name: LEAGUE, ended: false });
  source.join(1, "john", 1, true); // the admin
  source.join(1, "sam", 2);
  source.join(1, "ana", 3);
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

async function chat() {
  return (await chats.sync(1))!;
}

describe("membership", () => {
  it("makes one chat per league, titled with the league name, with its players and admins", async () => {
    const g = await chat();
    expect(g).toMatchObject({ leagueId: 1, openMatchId: null, title: LEAGUE, open: true });
    expect(provider.membersOf(g.channelId).sort()).toEqual(["ana", "john", "sam"]);
    expect((await chats.sync(1))!.id).toBe(g.id);
    expect(repo.groups).toHaveLength(1);
    expect((await repo.groupMembers(g.id)).find((m) => m.userId === "john")?.admin).toBe(true);
  });

  it("lists the chat in Messages from the start, as a league chat", async () => {
    const g = await chat();
    const [row] = await svc.groups("sam");
    expect(row).toMatchObject({ id: g.id, kind: "league", leagueId: 1, title: LEAGUE, unread: 0, isAdmin: false, canSend: true, lastMessage: null });
    expect((await svc.groups("john"))[0].isAdmin).toBe(true);
  });

  it("adds a player who joins, and they see the history", async () => {
    const g = await chat();
    await svc.sendToGroup("sam", g.id, { text: "Courts are wet", clientMessageId: mid() });
    source.join(1, "lee", 4);
    await chats.sync(1);
    expect(provider.membersOf(g.channelId)).toContain("lee");
    expect((await svc.groupThread("lee", g.id)).messages.map((m) => m.text)).toEqual(["Courts are wet"]);
  });

  it("takes out a player who leaves or is removed", async () => {
    const g = await chat();
    source.leave(1, "ana");
    await chats.sync(1);
    expect(provider.membersOf(g.channelId)).not.toContain("ana");
    await expectError(svc.groupThread("ana", g.id), "not_found", 404);
    await expectError(svc.sendToGroup("ana", g.id, { text: "Hello?", clientMessageId: mid() }), "not_found", 404);
    expect(await svc.groups("ana")).toEqual([]);
  });

  it("keeps an admin who stops playing, and follows admin changes", async () => {
    const g = await chat();
    // John stops playing but still runs the league (Q4); Sam becomes a co-admin.
    source.join(1, "john", null, true);
    source.join(1, "sam", 2, true);
    await chats.sync(1);
    const members = await repo.groupMembers(g.id);
    expect(members.find((m) => m.userId === "sam")?.admin).toBe(true);
    expect(members.find((m) => m.userId === "john")).toBeTruthy();
  });

  it("makes a missing chat the first time it's opened from the league page", async () => {
    const opened = await chats.chatFor(1, "sam");
    expect(opened).toMatchObject({ unread: 0, attention: 0 });
    expect(repo.groups[0].leagueId).toBe(1);
    expect(await chats.chatFor(1, "lee")).toBeNull(); // not in the league
  });

  it("brings in a member a join event missed when they open it", async () => {
    await chat();
    source.join(1, "lee", 4);
    expect(await chats.chatFor(1, "lee")).not.toBeNull();
  });

  it("gives every existing league its chat at startup, without touching anything else", async () => {
    source.leagues.set(2, { id: 2, name: "Doubles Night", ended: false });
    source.join(2, "lee", 4, true);
    source.leagues.set(3, { id: 3, name: "On hold", ended: false });
    expect(await chats.syncAll()).toEqual({ synced: 3, failed: 0 });
    expect(await chats.syncAll()).toEqual({ synced: 3, failed: 0 });
    expect(repo.groups.map((g) => g.title).sort()).toEqual(["Doubles Night", LEAGUE]); // nobody to talk to in league 3 yet
  });

  it("empties a deleted league's chat", async () => {
    const g = await chat();
    source.leagues.delete(1);
    await chats.sync(1);
    expect(await repo.groupMembers(g.id)).toEqual([]);
    expect(await svc.groups("sam")).toEqual([]);
  });
});

describe("unread and push (decision 146)", () => {
  it("a member post shows bold with its own count, but doesn't push or count on the button without a mention", async () => {
    const g = await chat();
    await svc.sendToGroup("sam", g.id, { text: "Anyone free Thursday?", clientMessageId: mid() });
    expect(pushed).toEqual([]);
    const [row] = await svc.groups("ana");
    expect(row).toMatchObject({ unread: 1, attention: 0 });
    expect((await svc.summary("ana")).unread).toBe(0);
  });

  it("an @mention pushes and counts for the person mentioned only", async () => {
    const g = await chat();
    await svc.sendToGroup("sam", g.id, { text: "@ana ruiz want to hit Thursday?", clientMessageId: mid() });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ recipientId: "ana", mention: true, groupTitle: LEAGUE, senderName: "Sam Patel" });
    expect((await svc.summary("ana")).unread).toBe(1);
    expect((await svc.summary("john")).unread).toBe(0);
    const thread = await svc.groupThread("ana", g.id);
    expect(thread.messages[0]).toMatchObject({ mentions: ["You"], mentionsMe: true, admin: false });
    expect((await svc.summary("ana")).unread).toBe(0);
    expect((await svc.groupThread("john", g.id)).messages[0]).toMatchObject({ mentions: ["Ana Ruiz"], mentionsMe: false });
  });

  it("an admin post is labeled, pushes to everyone and counts on the button", async () => {
    const g = await chat();
    await svc.sendToGroup("john", g.id, { text: "Courts 3 and 4 are closed Saturday.", clientMessageId: mid() });
    expect(pushed.map((p) => p.recipientId).sort()).toEqual(["ana", "sam"]);
    expect(pushed[0]).toMatchObject({ admin: true });
    expect((await svc.summary("sam")).unread).toBe(1);
    expect((await svc.groupThread("sam", g.id)).messages[0]).toMatchObject({ admin: true, senderName: "John Rapiel" });
  });

  it("automatic posts show and bold the row, but never push or count on the button", async () => {
    await chat();
    await chats.roundPublished(1, 4);
    expect(pushed).toEqual([]);
    expect((await svc.groups("sam"))[0]).toMatchObject({ unread: 1, attention: 0, lastMessage: { text: "Round 4 pairings are out.", senderName: null } });
    expect((await svc.summary("sam")).unread).toBe(0);
  });

  it("open match chats and direct messages still count as before", async () => {
    await chat();
    repo.playerAccounts.set(2, "sam");
    await svc.start("ana", { playerId: 2, text: "Hey", clientMessageId: mid() });
    expect((await svc.summary("sam")).unread).toBe(1);
  });

  it("push wording follows Show message previews", () => {
    const base = { conversationId: 9, senderName: "Sam Patel", text: "Courts are open", groupTitle: LEAGUE };
    expect(messagePushContent({ ...base, admin: true }, true)).toEqual({
      title: `Admin post in ${LEAGUE}`,
      body: "Sam Patel: Courts are open",
      link: "/conversation/group/9",
    });
    expect(messagePushContent({ ...base, admin: true }, false).body).toBe(`New admin post from Sam Patel in ${LEAGUE}`);
    expect(messagePushContent({ ...base, mention: true }, true)).toMatchObject({ title: `Sam Patel in ${LEAGUE}`, body: "Courts are open" });
    expect(messagePushContent({ ...base, mention: true }, false)).toMatchObject({ title: "", body: `Sam Patel mentioned you in ${LEAGUE}` });
  });
});

describe("blocks", () => {
  it("someone you have a block with can't reach you, even by @mention or as an admin", async () => {
    const g = await chat();
    repo.blocks.push(["ana", "john"]);
    await svc.sendToGroup("john", g.id, { text: "League dinner Friday", clientMessageId: mid() });
    await svc.sendToGroup("sam", g.id, { text: "@Ana Ruiz you in?", clientMessageId: mid() });
    expect(pushed.filter((p) => p.recipientId === "ana").map((p) => p.senderId)).toEqual(["sam"]);
    const thread = await svc.groupThread("ana", g.id);
    expect(thread.messages.map((m) => m.text)).toEqual(["@Ana Ruiz you in?"]);
    expect((await svc.groupMembers("ana", g.id)).map((m) => m.name)).toEqual(["Ana Ruiz", "Sam Patel"]);
  });

  it("a mention of someone with a block doesn't reach them", async () => {
    const g = await chat();
    repo.blocks.push(["sam", "ana"]);
    await svc.sendToGroup("sam", g.id, { text: "@Ana Ruiz hello", clientMessageId: mid() });
    expect(pushed).toEqual([]);
    expect((await svc.summary("ana")).unread).toBe(0);
  });
});

describe("an ended league", () => {
  it("stays readable but takes no new messages, and says so", async () => {
    const g = await chat();
    await svc.sendToGroup("sam", g.id, { text: "Good season", clientMessageId: mid() });
    source.leagues.set(1, { id: 1, name: LEAGUE, ended: true });
    await chats.sync(1);
    const thread = await svc.groupThread("ana", g.id);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: LEAGUE_ENDED });
    expect(thread.messages.map((m) => m.text)).toEqual(["Good season"]);
    await expectError(svc.sendToGroup("ana", g.id, { text: "Rematch?", clientMessageId: mid() }), "closed", 409);
    expect((await svc.groups("ana"))[0].canSend).toBe(false);
  });
});

describe("pins", () => {
  it("admins pin up to 3 posts, shown with the chat", async () => {
    const g = await chat();
    const ids: string[] = [];
    for (const text of ["Rules", "Courts", "Balls", "Dinner"]) {
      ids.push((await svc.sendToGroup("john", g.id, { text, clientMessageId: mid() })).message.id);
    }
    for (const id of ids.slice(0, MAX_PINS)) await svc.pin("john", g.id, { messageId: id });
    await expectError(svc.pin("john", g.id, { messageId: ids[3] }), "too_many_pins", 409);
    expect((await svc.groupThread("sam", g.id)).pins.map((p) => p.text)).toEqual(["Rules", "Courts", "Balls"]);
    await svc.unpin("john", g.id, ids[1]);
    await svc.pin("john", g.id, { messageId: ids[3] });
    expect((await svc.groupThread("sam", g.id)).pins.map((p) => p.text)).toEqual(["Rules", "Balls", "Dinner"]);
  });

  it("only admins pin", async () => {
    const g = await chat();
    const { message } = await svc.sendToGroup("sam", g.id, { text: "Hi", clientMessageId: mid() });
    await expectError(svc.pin("sam", g.id, { messageId: message.id }), "not_admin", 403);
  });
});

describe("admin moderation", () => {
  it("deletes a message for everyone and sends it to the moderation queue", async () => {
    const g = await chat();
    const { message } = await svc.sendToGroup("sam", g.id, { text: "something rude", clientMessageId: mid() });
    await svc.pin("john", g.id, { messageId: message.id });
    await svc.adminDelete("john", g.id, message.id);
    expect((await svc.groupThread("ana", g.id)).messages).toEqual([]);
    expect((await svc.groupThread("ana", g.id)).pins).toEqual([]);
    expect(mod.reports).toHaveLength(1);
    expect(mod.reports[0]).toMatchObject({ source: "league_admin", reporter: "john", subject: "sam", targetType: "message", targetId: message.id });
    expect(mod.reports[0].snapshot?.messages.at(-1)).toMatchObject({ text: "something rude", reported: true });
    await expectError(svc.adminDelete("sam", g.id, message.id), "not_admin", 403);
  });

  it("mutes a member: they read but can't send, and it's logged", async () => {
    const g = await chat();
    await svc.setMuted("john", g.id, { userId: 12 }, true);
    expect(mod.reports[0]).toMatchObject({ source: "league_admin", targetType: "account", subject: "sam" });
    const thread = await svc.groupThread("sam", g.id);
    expect(thread.group).toMatchObject({ canSend: false, sendBlockedReason: MUTED_REASON });
    await expectError(svc.sendToGroup("sam", g.id, { text: "Hey", clientMessageId: mid() }), "muted", 403);
    await svc.setMuted("john", g.id, { userId: 12 }, false);
    await svc.sendToGroup("sam", g.id, { text: "Thanks", clientMessageId: mid() });
  });

  it("lists members with their league player, for Remove from league", async () => {
    const g = await chat();
    const members = await svc.groupMembers("john", g.id);
    expect(members.find((m) => m.name === "Sam Patel")).toMatchObject({ playerId: 2, userId: 12, admin: false, muted: false, me: false });
    expect(members.find((m) => m.me)?.admin).toBe(true);
  });

  it("logs a removal started from the chat", async () => {
    await chat();
    await chats.removedFromChat(1, "john", "ana");
    expect(mod.reports[0]).toMatchObject({ source: "league_admin", subject: "ana", reporter: "john" });
  });
});

describe("automatic posts", () => {
  it("posts results, edits and who moved up in the standings", async () => {
    source.table = [
      { playerId: 1, name: "John Rapiel", rank: 1 },
      { playerId: 2, name: "Sam Patel", rank: 2 },
      { playerId: 3, name: "Ana Ruiz", rank: 3 },
    ];
    const g = await chat();
    source.results.set(50, { winners: ["Sam Patel"], losers: ["John Rapiel"], score: "6-3, 6-4", counts: true });
    source.table = [
      { playerId: 2, name: "Sam Patel", rank: 1 },
      { playerId: 1, name: "John Rapiel", rank: 2 },
      { playerId: 3, name: "Ana Ruiz", rank: 3 },
    ];
    await chats.resultEntered(1, 50);
    source.results.set(50, { winners: ["Sam Patel"], losers: ["John Rapiel"], score: "6-3, 7-5", counts: true });
    await chats.resultEntered(1, 50, { edited: true });
    const texts = (await svc.groupThread("ana", g.id)).messages.map((m) => m.text);
    expect(texts).toEqual(["Sam Patel def. John Rapiel 6-3, 6-4.", "Standings: Sam Patel moves up to 1st.", "Score edited: Sam Patel def. John Rapiel 6-3, 7-5."]);
    expect(pushed).toEqual([]);
  });

  it("still posts a final result in an ended league", async () => {
    await chat();
    source.leagues.set(1, { id: 1, name: LEAGUE, ended: true });
    await chats.sync(1);
    source.results.set(51, { winners: ["Ana Ruiz"], losers: ["Sam Patel"], score: "W/O", counts: false });
    await chats.resultEntered(1, 51);
    expect((await svc.groups("sam"))[0].lastMessage?.text).toBe("Ana Ruiz def. Sam Patel by walkover.");
  });
});

describe("account deletion", () => {
  it("takes the person out of every league chat, and the chat carries on", async () => {
    const g = await chat();
    await svc.sendToGroup("ana", g.id, { text: "Hi all", clientMessageId: mid() });
    await svc.deleteUserData("ana");
    expect(provider.membersOf(g.channelId)).not.toContain("ana");
    expect(await svc.groups("ana")).toEqual([]);
    const thread = await svc.groupThread("sam", g.id);
    expect(thread.group.canSend).toBe(true);
    expect(thread.messages.map((m) => m.text)).toEqual([]);
  });
});

describe("routes", () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use("/api", createMessagesRouter(() => svc, () => chats));
    return supertest(a);
  }

  it("opens a league's chat from the league page, and admins pin and mute", async () => {
    mockUserId = "john";
    const opened = await app().get("/api/leagues/1/chat");
    expect(opened.status).toBe(200);
    const groupId = opened.body.groupId as number;
    const sent = await app().post(`/api/messages/groups/${groupId}/messages`).send({ text: "Welcome", clientMessageId: mid() });
    expect(sent.status).toBe(201);
    expect((await app().post(`/api/messages/groups/${groupId}/pins`).send({ messageId: sent.body.message.id })).body.pinnedIds).toHaveLength(1);
    expect((await app().post(`/api/messages/groups/${groupId}/mute`).send({ userId: 13 })).body).toEqual({ muted: true });
    const members = await app().get(`/api/messages/groups/${groupId}/members`);
    expect(members.body.members.find((m: { name: string }) => m.name === "Ana Ruiz").muted).toBe(true);
    expect((await app().delete(`/api/messages/groups/${groupId}/pins/${encodeURIComponent(sent.body.message.id)}`)).body.pinnedIds).toEqual([]);

    // Every body fits the API contract (lib/api-spec/openapi.yaml).
    expect(zod.GetLeagueChatResponse.safeParse(opened.body).success).toBe(true);
    expect(zod.GetGroupMembersResponse.safeParse(members.body).success).toBe(true);
    mockUserId = "sam";
    await app().post(`/api/messages/groups/${groupId}/messages`).send({ text: "@John Rapiel thanks", clientMessageId: mid() });
    mockUserId = "john";
    const thread = await app().get(`/api/messages/groups/${groupId}`);
    expect(zod.GetGroupThreadResponse.safeParse(thread.body).success).toBe(true);
    expect(thread.body.messages.at(-1)).toMatchObject({ mentions: ["You"], mentionsMe: true });
    expect(zod.GetConversationsResponse.safeParse((await app().get("/api/messages")).body).success).toBe(true);
    const removed = await app().post(`/api/messages/groups/${groupId}/messages/${encodeURIComponent(sent.body.message.id)}/delete`).send({});
    expect(zod.AdminDeleteGroupMessageResponse.safeParse(removed.body).success).toBe(true);
    mockUserId = "lee";
    expect((await app().get("/api/leagues/1/chat")).status).toBe(404);
    mockUserId = "sam";
  });
});

describe("route events", () => {
  it("do nothing until the API starts league chats, then reach them", () => {
    expect(() => leagueChat.leagueChanged(1)).not.toThrow();
    const seen: number[] = [];
    setLeagueChatEvents({ leagueChanged: (id) => seen.push(id), roundPublished: vi.fn(), resultEntered: vi.fn(), removedFromChat: vi.fn() });
    leagueChat.leagueChanged(7);
    setLeagueChatEvents(null);
    leagueChat.leagueChanged(8);
    expect(seen).toEqual([7]);
  });
});
