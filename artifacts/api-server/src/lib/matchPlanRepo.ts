// Database reads and writes for match cards. The rules live in matchPlan.ts.

import { db, directoryCourtsTable, matchesTable, matchPlansTable, playersTable, usersTable, type MatchPlan } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { noShowCounts, pairKeyOf, type NewPlan, type PlanMatch } from "./matchPlan.js";

export interface PlanRow {
  plan: MatchPlan;
  match: PlanMatch;
}

export interface MatchPlanRepo {
  forPair(a: string, b: string): Promise<PlanRow[]>;
  one(id: number): Promise<PlanRow | null>;
  latestProposedId(pairKey: string): Promise<number | null>;
  create(proposer: string, recipient: string, plan: NewPlan, courtName: string | null): Promise<MatchPlan>;
  update(id: number, set: Partial<MatchPlan>): Promise<void>;
  /** Accepts and makes the match row (no league), both players on it. */
  accept(id: number, now: Date): Promise<void>;
  /** Takes the match off both schedules: voided, never counted. */
  voidMatch(matchId: number | null, now: Date): Promise<void>;
  isBlocked(a: string, b: string): Promise<boolean>;
  accountForUser(userId: number): Promise<{ clerkUserId: string; name: string } | null>;
  name(clerkUserId: string): Promise<string>;
  /** users.id for an account, to open your chat with them. */
  userIdOf(clerkUserId: string): Promise<number | null>;
  /** Their profile photo ("/objects/..."), if they set one. */
  photoOf(clerkUserId: string): Promise<string | null>;
  courtName(courtId: number): Promise<string | null>;
  /** Accepted, upcoming or just played, for Home and My matches. */
  upcomingFor(clerkUserId: string, since: Date): Promise<PlanRow[]>;
  noShowCounts(clerkUserIds: string[], now: Date): Promise<Map<string, number>>;
  /** Plans a reminder job should look at. */
  due(now: Date): Promise<PlanRow[]>;
  /** Claims a one-time send. True when this call won it. */
  claim(id: number, column: "dayBeforeSentAt" | "reminderSentAt" | "didItHappenSentAt" | "noShowExpirySentAt", now: Date): Promise<boolean>;
  file(input: { subject: string; details: string; planId: number }): Promise<void>;
}

const withMatch = () =>
  db
    .select({ plan: matchPlansTable, matchId: matchesTable.id, score: matchesTable.score })
    .from(matchPlansTable)
    .leftJoin(matchesTable, eq(matchesTable.id, matchPlansTable.matchId));

const toRow = (r: { plan: MatchPlan; matchId: number | null; score: string | null }): PlanRow => ({
  plan: r.plan,
  match: { matchId: r.matchId, score: r.score },
});

/** The league-free player row for an account, made when they have none. */
async function playerRowFor(clerkUserId: string): Promise<number> {
  const rows = await db
    .select({ id: playersTable.id, leagueId: playersTable.leagueId })
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, clerkUserId));
  const free = rows.find((r) => r.leagueId == null);
  if (free) return free.id;
  const [user] = await db.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  const [created] = await db.insert(playersTable).values({ name: user?.name ?? "Player", clerkUserId }).returning({ id: playersTable.id });
  return created.id;
}

export class DrizzleMatchPlanRepo implements MatchPlanRepo {
  async forPair(a: string, b: string) {
    const rows = await withMatch().where(eq(matchPlansTable.pairKey, pairKeyOf(a, b))).orderBy(matchPlansTable.createdAt);
    return rows.map(toRow);
  }

  async one(id: number) {
    const [row] = await withMatch().where(eq(matchPlansTable.id, id));
    return row ? toRow(row) : null;
  }

  async latestProposedId(pairKey: string) {
    const [row] = await db
      .select({ id: matchPlansTable.id })
      .from(matchPlansTable)
      .where(and(eq(matchPlansTable.pairKey, pairKey), eq(matchPlansTable.status, "proposed")))
      .orderBy(desc(matchPlansTable.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  async create(proposer: string, recipient: string, p: NewPlan, courtName: string | null) {
    const pairKey = pairKeyOf(proposer, recipient);
    return db.transaction(async (tx) => {
      // A newer card replaces any older one still waiting (brief item 29).
      await tx
        .update(matchPlansTable)
        .set({ status: "replaced" })
        .where(and(eq(matchPlansTable.pairKey, pairKey), eq(matchPlansTable.status, "proposed")));
      const [row] = await tx
        .insert(matchPlansTable)
        .values({
          pairKey,
          proposerClerkUserId: proposer,
          recipientClerkUserId: recipient,
          startsAt: p.startsAt,
          timeZone: p.timeZone,
          courtId: p.courtId,
          courtName,
          kind: p.kind,
        })
        .returning();
      return row;
    });
  }

  async update(id: number, set: Partial<MatchPlan>) {
    await db.update(matchPlansTable).set(set).where(eq(matchPlansTable.id, id));
  }

  async accept(id: number, now: Date) {
    const [plan] = await db.select().from(matchPlansTable).where(eq(matchPlansTable.id, id));
    if (!plan) return;
    const [p1, p2] = await Promise.all([playerRowFor(plan.proposerClerkUserId), playerRowFor(plan.recipientClerkUserId)]);
    await db.transaction(async (tx) => {
      const [match] = await tx
        .insert(matchesTable)
        .values({
          player1Id: p1,
          player2Id: p2,
          scheduledAt: plan.startsAt.toISOString(),
          location: plan.courtName,
          status: "scheduled",
          generatedFrom: "discover",
        })
        .returning({ id: matchesTable.id });
      await tx
        .update(matchPlansTable)
        .set({ status: "accepted", respondedAt: now, matchId: match.id })
        .where(and(eq(matchPlansTable.id, id), eq(matchPlansTable.status, "proposed")));
    });
  }

  async voidMatch(matchId: number | null, now: Date) {
    if (matchId == null) return;
    await db
      .update(matchesTable)
      .set({ status: "canceled", voidedAt: now })
      .where(and(eq(matchesTable.id, matchId), isNull(matchesTable.score)));
  }

  async isBlocked(a: string, b: string) {
    const result = await db.execute(sql`
      SELECT 1 FROM user_blocks
      WHERE (blocker_clerk_user_id = ${a} AND blocked_clerk_user_id = ${b})
         OR (blocker_clerk_user_id = ${b} AND blocked_clerk_user_id = ${a})
      LIMIT 1`);
    return result.rows.length > 0;
  }

  async accountForUser(userId: number) {
    const [u] = await db.select({ clerkUserId: usersTable.clerkUserId, name: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, userId));
    return u ?? null;
  }

  async name(clerkUserId: string) {
    const [u] = await db.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    return u?.name?.trim() || "Player";
  }

  async userIdOf(clerkUserId: string) {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    return u?.id ?? null;
  }

  async photoOf(clerkUserId: string) {
    const [u] = await db.select({ avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    return u?.avatarUrl ?? null;
  }

  async courtName(courtId: number) {
    const [c] = await db.select({ name: directoryCourtsTable.name }).from(directoryCourtsTable).where(eq(directoryCourtsTable.id, courtId));
    return c?.name ?? null;
  }

  async upcomingFor(clerkUserId: string, since: Date) {
    const rows = await withMatch()
      .where(
        and(
          eq(matchPlansTable.status, "accepted"),
          or(eq(matchPlansTable.proposerClerkUserId, clerkUserId), eq(matchPlansTable.recipientClerkUserId, clerkUserId)),
          sql`${matchPlansTable.startsAt} >= ${since}`,
        ),
      )
      .orderBy(matchPlansTable.startsAt);
    return rows.map(toRow);
  }

  async noShowCounts(clerkUserIds: string[], now: Date) {
    if (!clerkUserIds.length) return new Map<string, number>();
    const rows = await withMatch().where(and(inArray(matchPlansTable.noShowClerkUserId, clerkUserIds), isNotNull(matchPlansTable.noShowStatus)));
    return noShowCounts(rows.map(toRow), now);
  }

  async due(now: Date) {
    const soon = new Date(now.getTime() + 25 * 3_600_000);
    const rows = await withMatch().where(
      or(
        and(eq(matchPlansTable.status, "accepted"), lte(matchPlansTable.startsAt, soon), isNull(matchPlansTable.didItHappenSentAt)),
        and(eq(matchPlansTable.noShowStatus, "pending"), isNull(matchPlansTable.noShowExpirySentAt)),
      ),
    );
    return rows.map(toRow);
  }

  async claim(id: number, column: "dayBeforeSentAt" | "reminderSentAt" | "didItHappenSentAt" | "noShowExpirySentAt", now: Date) {
    const col = matchPlansTable[column];
    const rows = await db
      .update(matchPlansTable)
      .set({ [column]: now })
      .where(and(eq(matchPlansTable.id, id), isNull(col)))
      .returning({ id: matchPlansTable.id });
    return rows.length > 0;
  }

  async file(input: { subject: string; details: string; planId: number }) {
    await db.execute(sql`
      INSERT INTO content_reports (reporter_clerk_user_id, target_type, target_id, reason, details, status, source, subject_clerk_user_id)
      VALUES (NULL, 'match', ${`plan:${input.planId}`}, 'no_show_dispute', ${input.details}, 'open', 'auto', ${input.subject})`);
  }
}
