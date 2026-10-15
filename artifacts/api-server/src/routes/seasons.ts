import { Router } from "express";
import { db } from "@workspace/db";
import { seasonsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getSeasonsForLeague, findOverlappingSeason } from "../services/seasonService.js";
import { logger } from "../lib/logger";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatSeason(s: typeof seasonsTable.$inferSelect) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: s.id,
    leagueId: s.leagueId ?? null,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    isActive: s.startDate <= today && s.endDate >= today,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// GET /leagues/:leagueId/seasons — list seasons visible to this league (own + global)
router.get("/leagues/:leagueId/seasons", async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid leagueId" });

  try {
    const seasons = await getSeasonsForLeague(leagueId);
    return res.json(seasons);
  } catch (err) {
    logger.error({ err }, "Failed to get seasons");
    return res.status(500).json({ error: "Failed to fetch seasons" });
  }
});

// GET /leagues/:leagueId/seasons/active — get the currently active season
router.get("/leagues/:leagueId/seasons/active", async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid leagueId" });

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Check per-league first
    const leagueSeasons = await db
      .select()
      .from(seasonsTable)
      .where(eq(seasonsTable.leagueId, leagueId));

    const leagueActive = leagueSeasons.find((s) => s.startDate <= today && s.endDate >= today);
    if (leagueActive) return res.json(formatSeason(leagueActive));

    // Fall back to global
    const globals = await db.select().from(seasonsTable).where(isNull(seasonsTable.leagueId));
    const globalActive = globals.find((s) => s.startDate <= today && s.endDate >= today);
    if (globalActive) return res.json(formatSeason(globalActive));

    return res.json(null);
  } catch (err) {
    logger.error({ err }, "Failed to get active season");
    return res.status(500).json({ error: "Failed to fetch active season" });
  }
});

// POST /leagues/:leagueId/seasons — create a season for this league (admin only)
router.post("/leagues/:leagueId/seasons", requireAdmin, async (req, res) => {
  const leagueId = parseInt(req.params.leagueId as string);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid leagueId" });

  const { name, startDate, endDate } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!startDate || !DATE_RE.test(startDate)) {
    return res.status(400).json({ error: "startDate must be YYYY-MM-DD" });
  }
  if (!endDate || !DATE_RE.test(endDate)) {
    return res.status(400).json({ error: "endDate must be YYYY-MM-DD" });
  }
  if (startDate >= endDate) {
    return res.status(400).json({ error: "startDate must be before endDate" });
  }

  try {
    const conflict = await findOverlappingSeason(leagueId, startDate, endDate);
    if (conflict) {
      return res.status(409).json({
        error: `Date range overlaps with existing season "${conflict.name}" (${conflict.startDate} – ${conflict.endDate})`,
        conflictingSeasonId: conflict.id,
      });
    }

    const [season] = await db
      .insert(seasonsTable)
      .values({ leagueId, name: name.trim(), startDate, endDate })
      .returning();
    return res.status(201).json(formatSeason(season));
  } catch (err) {
    logger.error({ err }, "Failed to create season");
    return res.status(500).json({ error: "Failed to create season" });
  }
});

// PATCH /seasons/:id — update a season (admin only)
router.patch("/seasons/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { name, startDate, endDate } = req.body ?? {};

  if (startDate !== undefined && !DATE_RE.test(startDate)) {
    return res.status(400).json({ error: "startDate must be YYYY-MM-DD" });
  }
  if (endDate !== undefined && !DATE_RE.test(endDate)) {
    return res.status(400).json({ error: "endDate must be YYYY-MM-DD" });
  }

  try {
    const [existing] = await db
      .select()
      .from(seasonsTable)
      .where(eq(seasonsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Season not found" });

    const resolvedStart = (startDate as string | undefined) ?? existing.startDate;
    const resolvedEnd = (endDate as string | undefined) ?? existing.endDate;

    if (resolvedStart >= resolvedEnd) {
      return res.status(400).json({ error: "startDate must be before endDate" });
    }

    const conflict = await findOverlappingSeason(existing.leagueId, resolvedStart, resolvedEnd, id);
    if (conflict) {
      return res.status(409).json({
        error: `Date range overlaps with existing season "${conflict.name}" (${conflict.startDate} – ${conflict.endDate})`,
        conflictingSeasonId: conflict.id,
      });
    }

    const updates: Partial<typeof seasonsTable.$inferInsert> = {};
    if (name && typeof name === "string" && name.trim()) updates.name = name.trim();
    if (startDate) updates.startDate = resolvedStart;
    if (endDate) updates.endDate = resolvedEnd;

    const [season] = await db
      .update(seasonsTable)
      .set(updates)
      .where(eq(seasonsTable.id, id))
      .returning();

    return res.json(formatSeason(season));
  } catch (err) {
    logger.error({ err }, "Failed to update season");
    return res.status(500).json({ error: "Failed to update season" });
  }
});

// DELETE /seasons/:id — delete a season (admin only)
router.delete("/seasons/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(seasonsTable).where(eq(seasonsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Failed to delete season");
    return res.status(500).json({ error: "Failed to delete season" });
  }
});

export default router;
