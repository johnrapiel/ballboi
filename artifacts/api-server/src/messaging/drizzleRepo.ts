import { clerkClient } from "@clerk/express";
import {
  db,
  dmConversationsTable,
  messageGroupMembersTable,
  messageGroupsTable,
  playersTable,
  usersTable,
  type DmConversation,
  type DmStatus,
  type MessageGroupMember,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { accountsBlockedBy, blockedAccountsFor } from "../lib/blocks";
import { moderationRepo } from "./drizzleModeration";
import type {
  ConversationPatch,
  ConversationRecord,
  GroupMember,
  GroupPatch,
  GroupRecord,
  MessagingRepo,
  NewConversation,
  NewGroup,
  PersonSummary,
} from "./repo";

function toRecord(row: DmConversation): ConversationRecord {
  return { ...row, status: row.status as DmStatus };
}

function toMember(row: MessageGroupMember): GroupMember {
  return { groupId: row.groupId, userId: row.clerkUserId, unread: row.unread, firstSentAt: row.firstSentAt, joinedAt: row.joinedAt };
}

/** MessagingRepo on Postgres. */
export class DrizzleMessagingRepo implements MessagingRepo {
  private createdAtCache = new Map<string, Date | null>();

  async findByPair(pairKey: string) {
    const [row] = await db.select().from(dmConversationsTable).where(eq(dmConversationsTable.pairKey, pairKey));
    return row ? toRecord(row) : null;
  }

  async findById(id: number) {
    const [row] = await db.select().from(dmConversationsTable).where(eq(dmConversationsTable.id, id));
    return row ? toRecord(row) : null;
  }

  async create(input: NewConversation) {
    const [row] = await db
      .insert(dmConversationsTable)
      .values({ ...input, acceptedAt: input.status === "active" ? new Date() : null })
      .onConflictDoNothing()
      .returning();
    if (row) return toRecord(row);
    const existing = await this.findByPair(input.pairKey);
    if (!existing) throw new Error("Conversation insert failed");
    return existing;
  }

  async update(id: number, patch: ConversationPatch) {
    const [row] = await db.update(dmConversationsTable).set(patch).where(eq(dmConversationsTable.id, id)).returning();
    if (!row) throw new Error(`No conversation ${id}`);
    return toRecord(row);
  }

  async recordMessage(id: number, input: { sender: string; text: string; at: Date }) {
    const t = dmConversationsTable;
    const [row] = await db
      .update(t)
      .set({
        lastMessageAt: input.at,
        lastMessageText: input.text,
        lastSender: input.sender,
        aUnread: sql`CASE WHEN ${t.userA} = ${input.sender} THEN ${t.aUnread} ELSE ${t.aUnread} + 1 END`,
        bUnread: sql`CASE WHEN ${t.userB} = ${input.sender} THEN ${t.bUnread} ELSE ${t.bUnread} + 1 END`,
      })
      .where(eq(t.id, id))
      .returning();
    if (!row) throw new Error(`No conversation ${id}`);
    return toRecord(row);
  }

  async listFor(userId: string) {
    const rows = await db
      .select()
      .from(dmConversationsTable)
      .where(or(eq(dmConversationsTable.userA, userId), eq(dmConversationsTable.userB, userId)));
    return rows.map(toRecord);
  }

  async countStartedSince(userId: string, since: Date) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(dmConversationsTable)
      .where(and(eq(dmConversationsTable.requester, userId), gte(dmConversationsTable.createdAt, since)));
    return row?.n ?? 0;
  }

  /** Clerk's account creation time; the users row as a fallback. */
  async accountCreatedAt(userId: string) {
    if (this.createdAtCache.has(userId)) return this.createdAtCache.get(userId) ?? null;
    let created: Date | null = null;
    try {
      const user = await clerkClient.users.getUser(userId);
      created = new Date(user.createdAt);
    } catch {
      const [row] = await db.select({ createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.clerkUserId, userId));
      created = row?.createdAt ?? null;
    }
    // Only cache accounts past the first week; newer ones age out of the throttle.
    if (created && Date.now() - created.getTime() > 8 * 86_400_000) this.createdAtCache.set(userId, created);
    return created;
  }

  async areConnected(a: string, b: string, opts: { beyondOpenMatches?: boolean } = {}) {
    const league = await db.execute(sql`
      SELECT 1 FROM players p1
      JOIN players p2 ON p1.league_id = p2.league_id
      WHERE p1.clerk_user_id = ${a} AND p2.clerk_user_id = ${b} AND p1.league_id IS NOT NULL
      LIMIT 1`);
    if (league.rows.length) return true;
    const match = await db.execute(sql`
      SELECT 1 FROM matches m
      JOIN players pa ON pa.id IN (m.player1_id, m.player2_id, m.player3_id, m.player4_id)
      JOIN players pb ON pb.id IN (m.player1_id, m.player2_id, m.player3_id, m.player4_id)
      WHERE pa.clerk_user_id = ${a} AND pb.clerk_user_id = ${b}
        ${opts.beyondOpenMatches ? sql`AND NOT (m.generated_from = 'discover_open_match' AND m.score IS NULL)` : sql``}
      LIMIT 1`);
    return match.rows.length > 0;
  }

  blockedSetFor(userId: string) {
    return blockedAccountsFor(userId);
  }

  blockedByMe(userId: string) {
    return accountsBlockedBy(userId);
  }

  restrictedSet(userIds: string[]) {
    return moderationRepo().restrictedSet(userIds);
  }

  async findByChannel(channelId: string) {
    const [row] = await db.select().from(dmConversationsTable).where(eq(dmConversationsTable.channelId, channelId));
    return row ? toRecord(row) : null;
  }

  async people(userIds: string[]) {
    const out = new Map<string, PersonSummary>();
    if (!userIds.length) return out;
    const [users, players] = await Promise.all([
      db
        .select({ id: usersTable.clerkUserId, userId: usersTable.id, name: usersTable.displayName })
        .from(usersTable)
        .where(inArray(usersTable.clerkUserId, userIds)),
      db
        .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId, name: playersTable.name })
        .from(playersTable)
        .where(inArray(playersTable.clerkUserId, userIds)),
    ]);
    for (const id of userIds) {
      const player = players.find((p) => p.clerkUserId === id);
      const user = users.find((u) => u.id === id);
      const name = user?.name || player?.name || "Player";
      out.set(id, { name, playerId: player?.id ?? null, userId: user?.userId ?? null });
    }
    return out;
  }

  async accountForUser(userId: number) {
    const [row] = await db.select({ clerkUserId: usersTable.clerkUserId }).from(usersTable).where(eq(usersTable.id, userId));
    return row?.clerkUserId ?? null;
  }

  async accountForPlayer(playerId: number) {
    const [row] = await db.select({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(eq(playersTable.id, playerId));
    return row?.clerkUserId ?? null;
  }

  async contactsFor(userId: string) {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (p2.clerk_user_id) p2.clerk_user_id AS user_id, p2.id AS player_id,
        COALESCE(NULLIF(u.display_name, ''), p2.name) AS name
      FROM players p1
      JOIN players p2 ON p1.league_id = p2.league_id AND p2.clerk_user_id IS NOT NULL AND p2.clerk_user_id <> ${userId}
      LEFT JOIN users u ON u.clerk_user_id = p2.clerk_user_id
      WHERE p1.clerk_user_id = ${userId} AND p1.league_id IS NOT NULL
      ORDER BY p2.clerk_user_id, p2.id`);
    return (result.rows as { user_id: string; player_id: number; name: string }[])
      .map((r) => ({ userId: r.user_id, playerId: r.player_id, name: r.name }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  async deleteAllFor(userId: string) {
    await db
      .delete(dmConversationsTable)
      .where(or(eq(dmConversationsTable.userA, userId), eq(dmConversationsTable.userB, userId)));
  }

  // ─── Group chats (F15) ────────────────────────────────────────────────────

  async findGroup(id: number): Promise<GroupRecord | null> {
    const [row] = await db.select().from(messageGroupsTable).where(eq(messageGroupsTable.id, id));
    return row ?? null;
  }

  async findGroupByChannel(channelId: string): Promise<GroupRecord | null> {
    const [row] = await db.select().from(messageGroupsTable).where(eq(messageGroupsTable.channelId, channelId));
    return row ?? null;
  }

  async findGroupByOpenMatch(openMatchId: number): Promise<GroupRecord | null> {
    const [row] = await db.select().from(messageGroupsTable).where(eq(messageGroupsTable.openMatchId, openMatchId));
    return row ?? null;
  }

  async createGroup(input: NewGroup): Promise<GroupRecord> {
    const [row] = await db.insert(messageGroupsTable).values(input).onConflictDoNothing().returning();
    if (row) return row;
    const existing = await this.findGroupByChannel(input.channelId);
    if (!existing) throw new Error("Group insert failed");
    return existing;
  }

  async updateGroup(id: number, patch: GroupPatch): Promise<GroupRecord> {
    const [row] = await db.update(messageGroupsTable).set(patch).where(eq(messageGroupsTable.id, id)).returning();
    if (!row) throw new Error(`No group ${id}`);
    return row;
  }

  async groupMembers(id: number) {
    const rows = await db.select().from(messageGroupMembersTable).where(eq(messageGroupMembersTable.groupId, id));
    return rows.map(toMember);
  }

  async addGroupMembers(id: number, userIds: string[], at: Date) {
    if (!userIds.length) return;
    await db
      .insert(messageGroupMembersTable)
      .values(userIds.map((clerkUserId) => ({ groupId: id, clerkUserId, joinedAt: at })))
      .onConflictDoNothing();
  }

  async removeGroupMembers(id: number, userIds: string[]) {
    if (!userIds.length) return;
    await db
      .delete(messageGroupMembersTable)
      .where(and(eq(messageGroupMembersTable.groupId, id), inArray(messageGroupMembersTable.clerkUserId, userIds)));
  }

  async recordGroupMessage(id: number, input: { sender: string | null; text: string; at: Date; recipients: string[] }) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(messageGroupsTable)
        .set({ lastMessageAt: input.at, lastMessageText: input.text, lastSender: input.sender })
        .where(eq(messageGroupsTable.id, id))
        .returning();
      if (!row) throw new Error(`No group ${id}`);
      const m = messageGroupMembersTable;
      if (input.recipients.length) {
        await tx
          .update(m)
          .set({ unread: sql`${m.unread} + 1` })
          .where(and(eq(m.groupId, id), inArray(m.clerkUserId, input.recipients)));
      }
      if (input.sender) {
        await tx
          .update(m)
          .set({ firstSentAt: input.at })
          .where(and(eq(m.groupId, id), eq(m.clerkUserId, input.sender), isNull(m.firstSentAt)));
      }
      return row;
    });
  }

  async markGroupRead(id: number, userId: string) {
    const m = messageGroupMembersTable;
    await db
      .update(m)
      .set({ unread: 0 })
      .where(and(eq(m.groupId, id), eq(m.clerkUserId, userId)));
  }

  async groupsFor(userId: string) {
    const rows = await db
      .select({ group: messageGroupsTable, member: messageGroupMembersTable })
      .from(messageGroupMembersTable)
      .innerJoin(messageGroupsTable, eq(messageGroupsTable.id, messageGroupMembersTable.groupId))
      .where(eq(messageGroupMembersTable.clerkUserId, userId));
    return rows.map((r) => ({ group: r.group, member: toMember(r.member) }));
  }
}
