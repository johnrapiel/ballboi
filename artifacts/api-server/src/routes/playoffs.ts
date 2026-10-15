import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { playoffBracketsTable, leagueRoundsTable, leaguesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { generatePlayoffBracket, buildBracketResponse, MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS } from "../services/playoffBracket";
import { logger } from "../lib/logger";

const router = Router();

router.post("/leagues/:leagueId/playoffs/generate", requireAdmin, async (req, res) => {
  const leagueId = parseInt(req.params.leagueId as string);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

  try {
    const bracket = await generatePlayoffBracket(leagueId);
    return res.status(201).json(bracket);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playoff bracket";
    if (
      message.includes("already active") ||
      message.includes("Need at least") ||
      message.includes("not found") ||
      message.includes("singles leagues")
    ) {
      return res.status(400).json({ error: message });
    }
    logger.error({ err, leagueId }, "Failed to generate playoff bracket");
    return res.status(500).json({ error: message });
  }
});

router.get("/leagues/:leagueId/playoffs", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const leagueId = parseInt(req.params.leagueId as string);
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

  const [{ completedRoundCount }] = await db
    .select({ completedRoundCount: count() })
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.leagueId, leagueId), eq(leagueRoundsTable.status, "completed")));

  const eligibleForPlayoffs = completedRoundCount >= MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS;

  const [league] = await db.select({ leagueType: leaguesTable.leagueType }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  const singlesEligible = league?.leagueType === "singles";

  const brackets = await db
    .select()
    .from(playoffBracketsTable)
    .where(eq(playoffBracketsTable.leagueId, leagueId))
    .orderBy(playoffBracketsTable.createdAt);

  if (brackets.length === 0) {
    return res.json({
      bracket: null,
      eligibleForPlayoffs: eligibleForPlayoffs && singlesEligible,
      completedRoundCount,
    });
  }

  const latest = brackets[brackets.length - 1];
  const bracket = await buildBracketResponse(latest.id);
  return res.json({
    bracket,
    eligibleForPlayoffs: eligibleForPlayoffs && singlesEligible,
    completedRoundCount,
  });
});

export default router;
