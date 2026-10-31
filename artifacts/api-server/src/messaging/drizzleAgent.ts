import { clerkClient } from "@clerk/express";
import {
  contentReportsTable,
  db,
  messageReportSnapshotsTable,
  moderationAgentDecisionsTable,
  type ModerationAgentDecision,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, lte, ne, notExists, sql } from "drizzle-orm";
import type { AgentRepo, NewDecision, ReportForReview } from "./agent";
import { moderationRepo } from "./drizzleModeration";

/** AgentRepo on Postgres. */
export class DrizzleAgentRepo implements AgentRepo {
  async dueReports(createdBefore: Date, limit: number): Promise<ReportForReview[]> {
    const r = contentReportsTable;
    const rows = await db
      .select({ report: r, snapshot: messageReportSnapshotsTable.messages })
      .from(r)
      .leftJoin(messageReportSnapshotsTable, eq(messageReportSnapshotsTable.reportId, r.id))
      .where(
        and(
          eq(r.status, "open"),
          lte(r.createdAt, createdBefore),
          notExists(db.select({ one: sql`1` }).from(moderationAgentDecisionsTable).where(eq(moderationAgentDecisionsTable.reportId, r.id))),
        ),
      )
      .orderBy(asc(r.createdAt))
      .limit(limit);
    return rows.map(({ report, snapshot }) => ({
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      source: report.source,
      subject: report.subjectClerkUserId,
      reporter: report.reporterClerkUserId,
      status: report.status,
      createdAt: report.createdAt,
      snapshot: snapshot ?? null,
    }));
  }

  async history(subject: string, excludeReportId: number) {
    const r = contentReportsTable;
    const [row] = await db
      .select({
        otherReports: sql<number>`count(*)::int`,
        otherReporters: sql<number>`count(distinct ${r.reporterClerkUserId})::int`,
        upheldReports: sql<number>`count(*) filter (where ${r.status} = 'actioned')::int`,
      })
      .from(r)
      .where(and(eq(r.subjectClerkUserId, subject), ne(r.id, excludeReportId)));
    const restriction = await moderationRepo().activeRestriction(subject);
    let accountAgeDays: number | null = null;
    try {
      const user = await clerkClient.users.getUser(subject);
      accountAgeDays = Math.floor((Date.now() - user.createdAt) / 86_400_000);
    } catch {
      accountAgeDays = null;
    }
    return {
      otherReports: row?.otherReports ?? 0,
      otherReporters: row?.otherReporters ?? 0,
      upheldReports: row?.upheldReports ?? 0,
      activeRestriction: restriction?.reason ?? null,
      accountAgeDays,
    };
  }

  async setReportStatus(id: number, status: string) {
    await db
      .update(contentReportsTable)
      .set({ status, reviewedAt: status === "open" ? null : new Date() })
      .where(eq(contentReportsTable.id, id));
  }

  async recordDecision(d: NewDecision) {
    const [row] = await db.insert(moderationAgentDecisionsTable).values(d).returning();
    return row;
  }

  async listDecisions(opts: { pending: boolean }): Promise<ModerationAgentDecision[]> {
    const t = moderationAgentDecisionsTable;
    return db
      .select()
      .from(t)
      .where(opts.pending ? and(isNull(t.confirmedAt), isNull(t.undoneAt)) : undefined)
      .orderBy(desc(t.createdAt))
      .limit(200);
  }

  async getDecision(id: number) {
    const [row] = await db.select().from(moderationAgentDecisionsTable).where(eq(moderationAgentDecisionsTable.id, id));
    return row ?? null;
  }

  async markReviewed(id: number, kind: "confirm" | "undo", by: string) {
    const [row] = await db
      .update(moderationAgentDecisionsTable)
      .set(kind === "confirm" ? { confirmedAt: new Date(), reviewedBy: by } : { undoneAt: new Date(), reviewedBy: by })
      .where(eq(moderationAgentDecisionsTable.id, id))
      .returning();
    return row;
  }
}
