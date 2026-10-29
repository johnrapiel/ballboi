import { clerkClient } from "@clerk/express";
import { db, dmConversationsTable, playersTable, usersTable, type DmConversation, type DmStatus } from "@workspace/db";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { blockedAccountsFor } from "../lib/blocks";
import { moderationRepo } from "./drizzleModeration";
import type { ConversationPatch, ConversationRecord, MessagingRepo, NewConversation, PersonSummary } from "./repo";

function toRecord(row: DmConversation): ConversationRecord {
  return { ...row, status: row.status as DmStatus };
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

  async areConnected(a: string, b: string) {
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
      LIMIT 1`);
    return match.rows.length > 0;
  }

  blockedSetFor(userId: string) {
    return blockedAccountsFor(userId);
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
        .select({ id: usersTable.clerkUserId, name: usersTable.displayName })
        .from(usersTable)
        .where(inArray(usersTable.clerkUserId, userIds)),
      db
        .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId, name: playersTable.name })
        .from(playersTable)
        .where(inArray(playersTable.clerkUserId, userIds)),
    ]);
    for (const id of userIds) {
      const player = players.find((p) => p.clerkUserId === id);
      const name = users.find((u) => u.id === id)?.name || player?.name || "Player";
      out.set(id, { name, playerId: player?.id ?? null });
    }
    return out;
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
}
