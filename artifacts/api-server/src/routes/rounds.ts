import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, matchesTable, leaguesTable, playersTable } from "@workspace/db";
import { eq, desc, and, lte, gte, asc, inArray, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { generateAllRounds, buildRoundResponse } from "../services/roundPairing";
import { sendPushToUsers } from "./notifications";
import { logger } from "../lib/logger";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /leagues/:leagueId/rounds/generate
 * Generates all 6 pre-playoff rounds upfront (idempotent — only creates missing rounds).
 * If force=true, deletes any active/upcoming rounds first and regenerates from scratch.
 */
router.post("/leagues/:leagueId/rounds/generate", requireAdmin, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!league) return res.status(404).json({ error: "League not found" });

    const force = req.body?.force === true;

    if (force) {
      // Delete all upcoming rounds and their matches, then regenerate from scratch
      const allRounds = await db
        .select()
        .from(leagueRoundsTable)
        .where(eq(leagueRoundsTable.leagueId, leagueId));

      const upcomingIds = allRounds.filter((r) => r.status === "upcoming").map((r) => r.id);
      if (upcomingIds.length > 0) {
        // Delete matches that belong to upcoming rounds
        await db.delete(matchesTable).where(
          and(
            eq(matchesTable.leagueId, leagueId),
            isNotNull(matchesTable.roundId),
            inArray(matchesTable.roundId as any, upcomingIds)
          )
        );
        // Delete the upcoming round rows
        await db.delete(leagueRoundsTable).where(inArray(leagueRoundsTable.id, upcomingIds));
      }
    } else {
      // Close any expired active rounds
      const today = todayStr();
      const expiredActive = await db
        .select()
        .from(leagueRoundsTable)
        .where(and(eq(leagueRoundsTable.leagueId, leagueId), eq(leagueRoundsTable.status, "active")));
      for (const r of expiredActive.filter((r) => r.endDate < today)) {
        await db.update(leagueRoundsTable).set({ status: "completed" }).where(eq(leagueRoundsTable.id, r.id));
      }
    }

    const newRounds = await generateAllRounds(leagueId, 6);

    // Fire-and-forget push notifications for all newly created rounds
    // (we identify "new" by checking matchups that were just inserted)
    const allPlayerIds = new Set<number>();
    for (const round of newRounds) {
      for (const m of round.matchups) {
        allPlayerIds.add(m.player1Id);
        allPlayerIds.add(m.player2Id);
      }
    }

    if (allPlayerIds.size > 0) {
      db.select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(inArray(playersTable.id, [...allPlayerIds]))
        .then((players) => {
          const clerkMap: Record<number, string> = {};
          for (const p of players) {
            if (p.clerkUserId) clerkMap[p.id] = p.clerkUserId;
          }
          const sends: Promise<void>[] = [];
          for (const round of newRounds) {
            for (const m of round.matchups) {
              const p1Clerk = clerkMap[m.player1Id];
              const p2Clerk = clerkMap[m.player2Id];
              const label = round.status === "active"
                ? `Round ${round.roundNumber} — your matchup is set`
                : `Round ${round.roundNumber} scheduled (starts ${round.startDate})`;
              if (p1Clerk) {
                sends.push(
                  sendPushToUsers([p1Clerk], label, `You're playing ${m.player2Name}`, `/matches/${m.matchId}`)
                    .catch(() => {})
                );
              }
              if (p2Clerk) {
                sends.push(
                  sendPushToUsers([p2Clerk], label, `You're playing ${m.player1Name}`, `/matches/${m.matchId}`)
                    .catch(() => {})
                );
              }
            }
          }
          return Promise.all(sends);
        })
        .catch((err) => logger.error({ err }, "Failed to send round matchup notifications"));
    }

    // Return the active round (or first upcoming) as the primary result,
    // which matches the existing API shape the client expects
    const primary =
      newRounds.find((r) => r.status === "active") ??
      newRounds.find((r) => r.status === "upcoming") ??
      newRounds[0];

    return res.status(201).json(primary);
  } catch (err: any) {
    logger.error({ err }, "Failed to generate rounds");
    return res.status(500).json({ error: err.message ?? "Failed to generate rounds" });
  }
});

router.get("/leagues/:leagueId/rounds/current", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

    const today = todayStr();

    // First: return the currently active round whose window includes today
    const activeRounds = await db
      .select()
      .from(leagueRoundsTable)
      .where(and(
        eq(leagueRoundsTable.leagueId, leagueId),
        eq(leagueRoundsTable.status, "active"),
        lte(leagueRoundsTable.startDate, today),
        gte(leagueRoundsTable.endDate, today)
      ))
      .orderBy(desc(leagueRoundsTable.roundNumber));

    if (activeRounds.length > 0) {
      return res.json(await buildRoundResponse(activeRounds[0]));
    }

    // No active round: check for the nearest upcoming round
    const upcomingRounds = await db
      .select()
      .from(leagueRoundsTable)
      .where(and(
        eq(leagueRoundsTable.leagueId, leagueId),
        eq(leagueRoundsTable.status, "upcoming")
      ))
      .orderBy(asc(leagueRoundsTable.roundNumber))
      .limit(1);

    if (upcomingRounds.length > 0) {
      return res.json(await buildRoundResponse(upcomingRounds[0]));
    }

    // Fall back: most recent round if it still has unscheduled matches
    const recentRounds = await db
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId))
      .orderBy(desc(leagueRoundsTable.roundNumber))
      .limit(1);

    if (!recentRounds.length) return res.json(null);

    const roundResponse = await buildRoundResponse(recentRounds[0]);
    const hasUnscheduled = roundResponse.matchups.some(
      (m) => m.status !== "completed" && !m.scheduledAt
    );
    if (!hasUnscheduled) return res.json(null);

    return res.json(roundResponse);
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch current round");
    return res.status(500).json({ error: "Failed to fetch current round" });
  }
});

router.get("/leagues/:leagueId/rounds", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

    // Auto-generate any missing rounds so all 6 exist without requiring admin action
    const existing = await db
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId));

    if (existing.length < 6) {
      try {
        await generateAllRounds(leagueId, 6);
      } catch (genErr) {
        logger.warn({ genErr }, "Auto-generation of rounds failed; returning existing rounds");
      }
    }

    const rounds = await db
      .select()
      .from(leagueRoundsTable)
      .where(eq(leagueRoundsTable.leagueId, leagueId))
      .orderBy(asc(leagueRoundsTable.roundNumber));

    let results = await Promise.all(rounds.map(buildRoundResponse));

    // Auto-fix duplicate pairings in upcoming rounds (legacy greedy-algorithm data).
    // Only treat a duplicate as a problem when it falls within the rounds that can
    // theoretically be unique (rounds 1 … numPlayers-1 with circle method). Later
    // rounds for small leagues necessarily repeat and should be left alone.
    const upcomingResults = results.filter((r) => r.status === "upcoming");
    if (upcomingResults.length > 0) {
      // Derive player count from matchup data already available
      const allPlayerIds = new Set<number>();
      for (const r of results) {
        for (const m of r.matchups) {
          allPlayerIds.add(m.player1Id);
          allPlayerIds.add(m.player2Id);
        }
      }
      const numPlayers = allPlayerIds.size;
      // Circle method guarantees numPlayers-1 unique rounds; repeats beyond that are unavoidable
      const maxUniqueRounds = Math.max(0, numPlayers - 1);

      const seenPairs = new Set<string>();
      let hasDuplicates = false;

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        for (const m of r.matchups) {
          const key = [m.player1Id, m.player2Id].sort().join("-");
          if (r.status === "upcoming" && i < maxUniqueRounds && seenPairs.has(key)) {
            hasDuplicates = true;
            break;
          }
          seenPairs.add(key);
        }
        if (hasDuplicates) break;
      }

      if (hasDuplicates) {
        logger.info({ leagueId }, "Duplicate round pairings detected — auto-regenerating upcoming rounds");
        const upcomingIds = upcomingResults.map((r) => r.roundId);
        await db.delete(matchesTable).where(
          and(eq(matchesTable.leagueId, leagueId), inArray(matchesTable.roundId as any, upcomingIds))
        );
        await db.delete(leagueRoundsTable).where(inArray(leagueRoundsTable.id, upcomingIds));
        await generateAllRounds(leagueId, 6);

        const fixedRounds = await db
          .select()
          .from(leagueRoundsTable)
          .where(eq(leagueRoundsTable.leagueId, leagueId))
          .orderBy(asc(leagueRoundsTable.roundNumber));
        results = await Promise.all(fixedRounds.map(buildRoundResponse));
      }
    }

    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch rounds");
    return res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

export default router;
