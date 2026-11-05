import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueRoundsTable, matchesTable, leaguesTable, playersTable } from "@workspace/db";
import { eq, and, asc, inArray, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { generateAllRounds, buildRoundResponse } from "../services/roundPairing";
import { sendPushToUsers } from "./notifications";
import { logger } from "../lib/logger";
import { requireLeagueViewer } from "../middlewares/requireLeagueViewer.js";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { visibleRounds } from "../lib/draftRounds.js";

const router = Router();

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

    if (league.seasonWeeks) {
      return res.status(400).json({ error: "This league pairs a round each week; edit it from Manage." });
    }

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

/** Who's asking about this league's rounds: its admins also see drafts (decision 29). */
async function roundsFor(req: Request, leagueId: number) {
  const { userId } = getAuth(req);
  const isAdmin = !!userId && (await getLeagueRole(leagueId, userId)) !== null;
  const all = await db
    .select()
    .from(leagueRoundsTable)
    .where(eq(leagueRoundsTable.leagueId, leagueId))
    .orderBy(asc(leagueRoundsTable.roundNumber));
  return visibleRounds(all, isAdmin).sort((a, b) => a.roundNumber - b.roundNumber);
}

/**
 * The round to show now: the active one whose window includes today, else the
 * next upcoming one, else the latest if it still has unscheduled matches.
 * Players never see a round that hasn't gone out.
 */
router.get("/leagues/:leagueId/rounds/current", requireLeagueViewer, async (req, res) => {
  try {
    const leagueId = res.locals.leagueId as number;
    const today = todayStr();
    const rounds = await roundsFor(req, leagueId);

    const active = rounds
      .filter((r) => r.status === "active" && r.startDate <= today && r.endDate >= today)
      .at(-1);
    if (active) return res.json(await buildRoundResponse(active));

    const upcoming = rounds.find((r) => r.status === "upcoming");
    if (upcoming) return res.json(await buildRoundResponse(upcoming));

    const latest = rounds.at(-1);
    if (!latest) return res.json(null);
    const roundResponse = await buildRoundResponse(latest);
    const hasUnscheduled = roundResponse.matchups.some((m) => m.status !== "completed" && !m.scheduledAt);
    return res.json(hasUnscheduled ? roundResponse : null);
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch current round");
    return res.status(500).json({ error: "Failed to fetch current round" });
  }
});

/**
 * Every round of the league, in order. Reading never creates or re-pairs
 * rounds: only the 7am league job (services/leagueRounds.ts), the legacy
 * scheduler job, and an admin's own actions do.
 */
router.get("/leagues/:leagueId/rounds", requireLeagueViewer, async (req, res) => {
  try {
    const leagueId = res.locals.leagueId as number;
    const rounds = await roundsFor(req, leagueId);
    return res.json(await Promise.all(rounds.map(buildRoundResponse)));
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch rounds");
    return res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

export default router;
