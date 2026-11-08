// Career milestones (decisions 149 and 150): awarding, backfill and reads.
// The rules live in milestones.ts; the database sits behind MilestoneRepo so
// awarding and backfill are tested without one (__tests__/milestones.test.ts).

import { ballBoiSessionsTable, db, matchesTable, playerMilestonesTable, playersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { DrizzleCareerRepo, type CareerData } from "./careerRepo.js";
import { logger } from "./logger.js";
import { earnedMilestones, isMilestoneKind, type EarnedMilestone, type MilestoneKind, type MilestoneRecording } from "./milestones.js";

export interface StoredMilestone {
  kind: MilestoneKind;
  earnedAt: Date;
  seenAt: Date | null;
}

export interface MilestoneRepo {
  /** What the rules need: the account's career matches and saved recordings. */
  inputs(clerkUserId: string): Promise<{ career: CareerData; recordings: MilestoneRecording[] }>;
  stored(clerkUserId: string): Promise<StoredMilestone[]>;
  /** Inserts what isn't stored yet; returns the ones it inserted. */
  insert(clerkUserId: string, earned: EarnedMilestone[], seen: boolean): Promise<EarnedMilestone[]>;
  markSeen(clerkUserId: string, kinds: MilestoneKind[], at: Date): Promise<void>;
  /** Ball Boi accounts linked to a match's player rows. */
  accountsInMatch(matchId: number): Promise<string[]>;
  /** Every account with a player row, for the backfill. */
  allAccounts(): Promise<string[]>;
}

/** Recording statuses that mean the video was saved (uploaded), whatever analysis did next. */
const SAVED = ["processing", "completed", "failed"];

export class DrizzleMilestoneRepo implements MilestoneRepo {
  constructor(private readonly career = new DrizzleCareerRepo()) {}

  async inputs(clerkUserId: string) {
    const [career, mine] = await Promise.all([
      this.career.data(clerkUserId),
      db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId)),
    ]);
    const ids = mine.map((p) => p.id);
    const rows = ids.length
      ? await db
          .select({ matchId: ballBoiSessionsTable.matchId, stoppedAt: ballBoiSessionsTable.recordingStoppedAt, startedAt: ballBoiSessionsTable.recordingStartedAt })
          .from(ballBoiSessionsTable)
          .innerJoin(matchesTable, eq(matchesTable.id, ballBoiSessionsTable.matchId))
          .where(
            and(
              inArray(ballBoiSessionsTable.status, SAVED),
              or(
                inArray(matchesTable.player1Id, ids),
                inArray(matchesTable.player2Id, ids),
                inArray(matchesTable.player3Id, ids),
                inArray(matchesTable.player4Id, ids),
              ),
            ),
          )
      : [];
    return { career, recordings: rows.map((r) => ({ matchId: r.matchId, at: (r.stoppedAt ?? r.startedAt).toISOString() })) };
  }

  async stored(clerkUserId: string) {
    const rows = await db
      .select({ kind: playerMilestonesTable.kind, earnedAt: playerMilestonesTable.earnedAt, seenAt: playerMilestonesTable.seenAt })
      .from(playerMilestonesTable)
      .where(eq(playerMilestonesTable.clerkUserId, clerkUserId));
    return rows.filter((r): r is StoredMilestone => isMilestoneKind(r.kind));
  }

  async insert(clerkUserId: string, earned: EarnedMilestone[], seen: boolean) {
    if (!earned.length) return [];
    const now = new Date();
    const rows = await db
      .insert(playerMilestonesTable)
      .values(earned.map((e) => ({ clerkUserId, kind: e.kind, earnedAt: new Date(e.earnedAt), matchId: e.matchId, seenAt: seen ? now : null })))
      .onConflictDoNothing()
      .returning({ kind: playerMilestonesTable.kind });
    const added = new Set(rows.map((r) => r.kind));
    return earned.filter((e) => added.has(e.kind));
  }

  async markSeen(clerkUserId: string, kinds: MilestoneKind[], at: Date) {
    if (!kinds.length) return;
    await db
      .update(playerMilestonesTable)
      .set({ seenAt: at })
      .where(and(eq(playerMilestonesTable.clerkUserId, clerkUserId), inArray(playerMilestonesTable.kind, kinds), isNull(playerMilestonesTable.seenAt)));
  }

  async accountsInMatch(matchId: number) {
    const [m] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!m) return [];
    const ids = [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null);
    const rows = await db.select({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, ids));
    return [...new Set(rows.map((r) => r.clerkUserId).filter((id): id is string => !!id))];
  }

  async allAccounts() {
    const rows = await db.selectDistinct({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(isNotNull(playersTable.clerkUserId));
    return rows.map((r) => r.clerkUserId).filter((id): id is string => !!id);
  }
}

/** Awards whatever the account has earned and doesn't have yet. Returns the new ones. */
export async function awardMilestones(repo: MilestoneRepo, clerkUserId: string, opts: { seen: boolean }): Promise<EarnedMilestone[]> {
  const [{ career, recordings }, stored] = await Promise.all([repo.inputs(clerkUserId), repo.stored(clerkUserId)]);
  const have = new Set(stored.map((s) => s.kind));
  const missing = earnedMilestones({ ...career, account: clerkUserId }, recordings).filter((e) => !have.has(e.kind));
  return missing.length ? repo.insert(clerkUserId, missing, opts.seen) : [];
}

/**
 * After a result or recording is saved: every Ball Boi player in the match
 * gets what it earned. The moment plays the next time they open the app.
 * Never throws; a miss is caught by the next save or the start-up backfill.
 */
export async function awardMilestonesForMatch(matchId: number, repo: MilestoneRepo = new DrizzleMilestoneRepo()): Promise<void> {
  try {
    const accounts = await repo.accountsInMatch(matchId);
    for (const a of accounts) await awardMilestones(repo, a, { seen: false });
  } catch (err) {
    logger.error({ err, matchId }, "Couldn't award milestones");
  }
}

/**
 * Backfill for players who earned milestones before they existed. Idempotent:
 * only what's missing is inserted, so it's safe on every start. Backfilled
 * milestones show on cards and Career with the date they were earned, marked
 * as already seen, so nobody opens the app to a run of old moments.
 */
export async function backfillMilestones(repo: MilestoneRepo = new DrizzleMilestoneRepo()): Promise<{ accounts: number; added: number }> {
  let added = 0;
  const accounts = await repo.allAccounts();
  for (const a of accounts) {
    try {
      added += (await awardMilestones(repo, a, { seen: true })).length;
    } catch (err) {
      logger.error({ err }, "Milestone backfill failed for one account");
    }
  }
  return { accounts: accounts.length, added };
}
