import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import {
  contentReportsTable,
  db,
  messageReportSnapshotsTable,
  playersTable,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  userBlocksTable,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import pino from "pino";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAutoRestrict } from "../messaging";

// App Store guideline 1.2: report objectionable content, block abusive users,
// and act on every report within 24 hours. Spec: Messaging and moderation.

const logger = pino({ name: "safety" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export interface ParsedReport {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

/** Validates a report body. Returns the clean report, or an error message. */
export function parseReport(body: unknown): ParsedReport | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  // Messages are reported through /messages/:id/report (with a snapshot); "account" reports are system-filed.
  if (!isOneOf(REPORT_TARGET_TYPES, b.targetType) || b.targetType === "message" || b.targetType === "account") {
    return { error: "Unknown report target" };
  }
  if (!isOneOf(REPORT_REASONS, b.reason)) return { error: "Unknown report reason" };
  const targetId =
    typeof b.targetId === "number" && Number.isFinite(b.targetId)
      ? String(b.targetId)
      : typeof b.targetId === "string" && b.targetId.trim()
        ? b.targetId.trim()
        : null;
  if (!targetId || targetId.length > 100) return { error: "Missing report target id" };
  let details: string | undefined;
  if (b.details !== undefined && b.details !== null) {
    if (typeof b.details !== "string") return { error: "Details must be text" };
    details = b.details.trim().slice(0, 1000) || undefined;
  }
  return { targetType: b.targetType, targetId, reason: b.reason, details };
}

router.post("/reports", requireAuth, async (req, res) => {
  const parsed = parseReport(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { userId } = getAuth(req);
  // Player reports count toward auto-restrict ("reported by 2 or more different people").
  const subject = parsed.targetType === "player" && /^\d+$/.test(parsed.targetId) ? await accountForPlayer(Number(parsed.targetId)) : null;
  const [report] = await db
    .insert(contentReportsTable)
    .values({ reporterClerkUserId: userId!, ...parsed, source: "user", subjectClerkUserId: subject })
    .returning({ id: contentReportsTable.id });
  if (subject && subject !== userId) await restrictQuietly(subject, "report");
  // Surfaces in logs so a person reviews it within 24 hours. Push alert to the
  // moderator comes with APNs (checklist: 24-hour review, staffed).
  logger.warn({ reportId: report.id, targetType: parsed.targetType, reason: parsed.reason }, "New content report");
  res.status(201).json({ id: report.id, status: "open" });
});

/** Auto-restrict never blocks the report or block it follows. */
async function restrictQuietly(subject: string, kind: "report" | "block") {
  try {
    await getAutoRestrict().evaluate(subject, { kind });
  } catch (err) {
    logger.error({ err }, "Auto-restrict check failed");
  }
}

router.get("/admin/reports", requireAdmin, async (req, res) => {
  const status = isOneOf(REPORT_STATUSES, req.query.status) ? req.query.status : "open";
  const rows = await db
    .select()
    .from(contentReportsTable)
    .where(eq(contentReportsTable.status, status))
    .orderBy(desc(contentReportsTable.createdAt))
    .limit(200);
  // Message reports carry a snapshot of the conversation at the time of the report.
  const snapshots = rows.length
    ? await db
        .select()
        .from(messageReportSnapshotsTable)
        .where(inArray(messageReportSnapshotsTable.reportId, rows.map((r) => r.id)))
    : [];
  res.json(
    rows.map((r) => {
      const snap = snapshots.find((s) => s.reportId === r.id);
      return { ...r, snapshot: snap ? { conversationId: snap.conversationId, messages: snap.messages } : null };
    }),
  );
});

router.patch("/admin/reports/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status: unknown = req.body?.status;
  if (!Number.isInteger(id) || !isOneOf<ReportStatus>(REPORT_STATUSES, status)) {
    res.status(400).json({ error: "Invalid id or status" });
    return;
  }
  const [row] = await db
    .update(contentReportsTable)
    .set({ status, reviewedAt: new Date() })
    .where(eq(contentReportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(row);
});

/** The account behind a player id. Players without an account can't be blocked. */
async function accountForPlayer(playerId: number): Promise<string | null> {
  const [player] = await db
    .select({ clerkUserId: playersTable.clerkUserId })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  return player?.clerkUserId ?? null;
}

router.get("/blocks", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const blocks = await db
    .select({ blockedClerkUserId: userBlocksTable.blockedClerkUserId, createdAt: userBlocksTable.createdAt })
    .from(userBlocksTable)
    .where(eq(userBlocksTable.blockerClerkUserId, userId!));
  const blockedIds = blocks.map((b) => b.blockedClerkUserId);
  const players = blockedIds.length
    ? await db
        .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(inArray(playersTable.clerkUserId, blockedIds))
    : [];
  res.json(
    blocks.map((b) => {
      const p = players.find((x) => x.clerkUserId === b.blockedClerkUserId);
      return { playerId: p?.id ?? null, name: p?.name ?? "Player", blockedAt: b.createdAt.toISOString() };
    }),
  );
});

router.post("/players/:playerId/block", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(playerId)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }
  const target = await accountForPlayer(playerId);
  if (!target) {
    res.status(404).json({ error: "This player doesn't have an account to block." });
    return;
  }
  if (target === userId) {
    res.status(400).json({ error: "You can't block yourself." });
    return;
  }
  await db
    .insert(userBlocksTable)
    .values({ blockerClerkUserId: userId!, blockedClerkUserId: target })
    .onConflictDoNothing();
  await restrictQuietly(target, "block");
  res.status(201).json({ blocked: true });
});

router.delete("/players/:playerId/block", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const playerId = Number(req.params.playerId);
  const target = Number.isInteger(playerId) ? await accountForPlayer(playerId) : null;
  if (target) {
    await db
      .delete(userBlocksTable)
      .where(and(eq(userBlocksTable.blockerClerkUserId, userId!), eq(userBlocksTable.blockedClerkUserId, target)));
  }
  res.status(204).end();
});

export default router;
