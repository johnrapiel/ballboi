// Database reads and writes for match requests. Rules live in matchRequests.ts.

import { db, directoryCourtsTable, matchesTable, matchRequestsTable, usersTable, type MatchRequestRow } from "@workspace/db";
import { and, between, count, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

import type { NewMatchRequest } from "./matchRequests.js";
import { myPlayerId } from "./quickPlayer.js";

export type MatchRequest = MatchRequestRow;
export type RequestChange = Partial<Omit<MatchRequestRow, "id" | "fromClerkUserId" | "toClerkUserId" | "createdAt">>;

export interface MatchRequestRepo {
  create(from: string, to: string, input: Omit<NewMatchRequest, "toUserId">): Promise<MatchRequest>;
  byId(id: number): Promise<MatchRequest | null>;
  /** Every request a player sent or got, newest first. */
  mine(clerkUserId: string): Promise<MatchRequest[]>;
  /** Pending or accepted requests between two players, either way. */
  openBetween(a: string, b: string): Promise<MatchRequest[]>;
  sentSince(clerkUserId: string, since: Date): Promise<number>;
  /**
   * Saves a change only if the request is still as it was read (same status
   * and updatedAt), so two answers at once can't both land. Null when it moved.
   */
  update(r: MatchRequest, change: RequestChange): Promise<MatchRequest | null>;
  /** The match for an accepted request, outside any league. */
  makeMatch(from: string, to: string, scheduledAt: Date, location: string | null): Promise<number>;
  /** Calls off an accepted request's match, unless a score is already in. */
  cancelMatch(matchId: number): Promise<void>;
  /** Names and user ids by account. */
  people(clerkUserIds: string[]): Promise<Map<string, { userId: number; name: string }>>;
  courtNames(ids: number[]): Promise<Map<number, string>>;
  /** Which of these matches have a score in. */
  scored(matchIds: number[]): Promise<Set<number>>;
  /** Accepted requests on or around today, for the reminder job. */
  acceptedAround(fromDate: string, toDate: string): Promise<MatchRequest[]>;
  /** Claims a push before it's sent. False when it was already claimed. */
  claim(id: number, field: "confirmPromptSentAt" | "reminderSentAt"): Promise<boolean>;
  /** How many no-shows other players reported for each account. */
  noShowCounts(clerkUserIds: string[]): Promise<Map<string, number>>;
}

export class DrizzleMatchRequestRepo implements MatchRequestRepo {
  async create(from: string, to: string, input: Omit<NewMatchRequest, "toUserId">) {
    const [r] = await db
      .insert(matchRequestsTable)
      .values({
        fromClerkUserId: from,
        toClerkUserId: to,
        date: input.date,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: input.timeZone,
        courtId: input.courtId,
        kind: input.kind,
        note: input.note,
        waitingOnClerkUserId: to,
      })
      .returning();
    return r;
  }

  async byId(id: number) {
    const [r] = await db.select().from(matchRequestsTable).where(eq(matchRequestsTable.id, id));
    return r ?? null;
  }

  async mine(clerkUserId: string) {
    const rows = await db
      .select()
      .from(matchRequestsTable)
      .where(or(eq(matchRequestsTable.fromClerkUserId, clerkUserId), eq(matchRequestsTable.toClerkUserId, clerkUserId)));
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async openBetween(a: string, b: string) {
    return db
      .select()
      .from(matchRequestsTable)
      .where(
        and(
          inArray(matchRequestsTable.status, ["pending", "accepted"]),
          or(
            and(eq(matchRequestsTable.fromClerkUserId, a), eq(matchRequestsTable.toClerkUserId, b)),
            and(eq(matchRequestsTable.fromClerkUserId, b), eq(matchRequestsTable.toClerkUserId, a)),
          ),
        ),
      );
  }

  async sentSince(clerkUserId: string, since: Date) {
    const [r] = await db
      .select({ n: count() })
      .from(matchRequestsTable)
      .where(and(eq(matchRequestsTable.fromClerkUserId, clerkUserId), gt(matchRequestsTable.createdAt, since)));
    return Number(r?.n ?? 0);
  }

  async update(r: MatchRequest, change: RequestChange) {
    const [saved] = await db
      .update(matchRequestsTable)
      .set({ ...change, updatedAt: new Date() })
      .where(
        and(
          eq(matchRequestsTable.id, r.id),
          eq(matchRequestsTable.status, r.status),
          eq(matchRequestsTable.updatedAt, r.updatedAt),
        ),
      )
      .returning();
    return saved ?? null;
  }

  async makeMatch(from: string, to: string, scheduledAt: Date, location: string | null) {
    const [a, b] = await Promise.all([myPlayerId(from), myPlayerId(to)]);
    const [m] = await db
      .insert(matchesTable)
      .values({
        player1Id: a.id,
        player2Id: b.id,
        scheduledAt: scheduledAt.toISOString(),
        status: "scheduled",
        location,
        generatedFrom: "match_request",
      })
      .returning({ id: matchesTable.id });
    return m.id;
  }

  async cancelMatch(matchId: number) {
    await db
      .update(matchesTable)
      .set({ status: "cancelled" })
      .where(and(eq(matchesTable.id, matchId), ne(matchesTable.status, "completed")));
  }

  async people(clerkUserIds: string[]) {
    const out = new Map<string, { userId: number; name: string }>();
    if (!clerkUserIds.length) return out;
    const rows = await db
      .select({ clerkUserId: usersTable.clerkUserId, userId: usersTable.id, name: usersTable.displayName })
      .from(usersTable)
      .where(inArray(usersTable.clerkUserId, clerkUserIds));
    for (const r of rows) out.set(r.clerkUserId, { userId: r.userId, name: r.name ?? "Player" });
    return out;
  }

  async courtNames(ids: number[]) {
    const out = new Map<number, string>();
    if (!ids.length) return out;
    const rows = await db
      .select({ id: directoryCourtsTable.id, name: directoryCourtsTable.name })
      .from(directoryCourtsTable)
      .where(inArray(directoryCourtsTable.id, ids));
    for (const r of rows) out.set(r.id, r.name);
    return out;
  }

  async scored(matchIds: number[]) {
    if (!matchIds.length) return new Set<number>();
    const rows = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(inArray(matchesTable.id, matchIds), eq(matchesTable.status, "completed")));
    return new Set(rows.map((r) => r.id));
  }

  async acceptedAround(fromDate: string, toDate: string) {
    return db
      .select()
      .from(matchRequestsTable)
      .where(and(eq(matchRequestsTable.status, "accepted"), between(matchRequestsTable.date, fromDate, toDate)));
  }

  async claim(id: number, field: "confirmPromptSentAt" | "reminderSentAt") {
    const column = field === "confirmPromptSentAt" ? matchRequestsTable.confirmPromptSentAt : matchRequestsTable.reminderSentAt;
    const rows = await db
      .update(matchRequestsTable)
      .set({ [field]: new Date() })
      .where(and(eq(matchRequestsTable.id, id), isNull(column)))
      .returning({ id: matchRequestsTable.id });
    return rows.length > 0;
  }

  async noShowCounts(clerkUserIds: string[]) {
    const out = new Map<string, number>();
    if (!clerkUserIds.length) return out;
    const rows = await db
      .select({ who: matchRequestsTable.noShowClerkUserId, n: count() })
      .from(matchRequestsTable)
      .where(and(isNotNull(matchRequestsTable.noShowClerkUserId), inArray(matchRequestsTable.noShowClerkUserId, clerkUserIds)))
      .groupBy(matchRequestsTable.noShowClerkUserId);
    for (const r of rows) if (r.who) out.set(r.who, Number(r.n));
    return out;
  }
}
