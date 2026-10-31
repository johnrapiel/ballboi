import {
  contentReportsTable,
  db,
  dmConversationsTable,
  messageReportSnapshotsTable,
  messagingRestrictionsTable,
  userBlocksTable,
  type RestrictionSource,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { ModerationRepo, NewReport, Restriction } from "./moderation";

function toRestriction(row: typeof messagingRestrictionsTable.$inferSelect): Restriction {
  return { ...row, source: row.source as RestrictionSource };
}

/** ModerationRepo on Postgres. */
export class DrizzleModerationRepo implements ModerationRepo {
  async createReport(report: NewReport) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contentReportsTable)
        .values({
          reporterClerkUserId: report.reporter,
          targetType: report.targetType,
          targetId: report.targetId,
          reason: report.reason,
          details: report.details,
          source: report.source,
          subjectClerkUserId: report.subject,
        })
        .returning({ id: contentReportsTable.id });
      if (report.snapshot) {
        await tx.insert(messageReportSnapshotsTable).values({
          reportId: row.id,
          conversationId: report.snapshot.conversationId,
          messages: report.snapshot.messages,
        });
      }
      return row.id;
    });
  }

  async distinctReportersAgainst(subject: string) {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${contentReportsTable.reporterClerkUserId})::int` })
      .from(contentReportsTable)
      .where(
        and(
          eq(contentReportsTable.subjectClerkUserId, subject),
          isNotNull(contentReportsTable.reporterClerkUserId),
          ne(contentReportsTable.status, "dismissed"),
        ),
      );
    return row?.n ?? 0;
  }

  async distinctBlockersSince(subject: string, since: Date) {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${userBlocksTable.blockerClerkUserId})::int` })
      .from(userBlocksTable)
      .where(and(eq(userBlocksTable.blockedClerkUserId, subject), gte(userBlocksTable.createdAt, since)));
    return row?.n ?? 0;
  }

  async unansweredRequests(subject: string, createdBefore: Date, createdAfter: Date) {
    const t = dmConversationsTable;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.requester, subject), ne(t.status, "active"), lte(t.createdAt, createdBefore), gte(t.createdAt, createdAfter)));
    return row?.n ?? 0;
  }

  async sameOpenerSince(subject: string, openingHash: string, since: Date) {
    const t = dmConversationsTable;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.requester, subject), eq(t.openingHash, openingHash), gte(t.createdAt, since)));
    return row?.n ?? 0;
  }

  async activeRestriction(subject: string) {
    const [row] = await db
      .select()
      .from(messagingRestrictionsTable)
      .where(and(eq(messagingRestrictionsTable.clerkUserId, subject), isNull(messagingRestrictionsTable.liftedAt)));
    return row ? toRestriction(row) : null;
  }

  async restrict(input: { subject: string; reason: string; source: RestrictionSource; reportId: number | null }) {
    const existing = await this.activeRestriction(input.subject);
    if (existing) return existing;
    const [row] = await db
      .insert(messagingRestrictionsTable)
      .values({ clerkUserId: input.subject, reason: input.reason, source: input.source, reportId: input.reportId })
      .returning();
    return toRestriction(row);
  }

  async lift(subject: string, by: string) {
    const rows = await db
      .update(messagingRestrictionsTable)
      .set({ liftedAt: new Date(), liftedBy: by })
      .where(and(eq(messagingRestrictionsTable.clerkUserId, subject), isNull(messagingRestrictionsTable.liftedAt)))
      .returning({ id: messagingRestrictionsTable.id });
    return rows.length > 0;
  }

  async restrictedSet(subjects: string[]) {
    if (!subjects.length) return new Set<string>();
    const rows = await db
      .select({ id: messagingRestrictionsTable.clerkUserId })
      .from(messagingRestrictionsTable)
      .where(and(inArray(messagingRestrictionsTable.clerkUserId, subjects), isNull(messagingRestrictionsTable.liftedAt)));
    return new Set(rows.map((r) => r.id));
  }
}

let shared: DrizzleModerationRepo | null = null;
export function moderationRepo(): DrizzleModerationRepo {
  shared ??= new DrizzleModerationRepo();
  return shared;
}
