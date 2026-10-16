import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import {
  contentReportsTable,
  db,
  playersTable,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  userBlocksTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import pino from "pino";
import { requireAdmin } from "../middlewares/requireAdmin";

// App Store guideline 1.2: report objectionable content, block abusive users,
// and act on reports within 24 hours.

const logger = pino({ name: "safety" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const ReportBody = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.union([z.string(), z.number()]).transform(String),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

router.post("/reports", requireAuth, async (req, res) => {
  const parsed = ReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report", issues: parsed.error.issues });
    return;
  }
  const { userId } = getAuth(req);
  const [report] = await db
    .insert(contentReportsTable)
    .values({ reporterClerkUserId: userId!, ...parsed.data })
    .returning({ id: contentReportsTable.id });
  // Surfaces in logs/alerting so a human reviews it within 24 hours.
  logger.warn({ reportId: report.id, ...parsed.data }, "New content report");
  res.status(201).json({ id: report.id, status: "open" });
});

router.get("/admin/reports", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  const rows = await db
    .select()
    .from(contentReportsTable)
    .where(eq(contentReportsTable.status, status))
    .orderBy(desc(contentReportsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.patch("/admin/reports/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = z.enum(REPORT_STATUSES).safeParse(req.body?.status);
  if (!Number.isInteger(id) || !status.success) {
    res.status(400).json({ error: "Invalid id or status" });
    return;
  }
  const [row] = await db
    .update(contentReportsTable)
    .set({ status: status.data, reviewedAt: new Date() })
    .where(eq(contentReportsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(row);
});

/** Resolve a player id to the account behind it. Unlinked players can't be blocked. */
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
