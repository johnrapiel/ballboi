import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, matchesTable, playersTable, scheduleGenerationLogsTable, leaguesTable } from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { generateWeeklyMatches, saveGeneratedMatches } from "../services/matchGeneration";
import { sendPushToUsers } from "./notifications";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getPlayerNameMap } from "../lib/lookups.js";

const router = Router();

function isScheduleStatus() {
  return or(
    eq(scheduleGenerationLogsTable.status, "pending_review"),
    eq(scheduleGenerationLogsTable.status, "confirmed")
  );
}

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

function getWeekOf(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  // Normalize to Monday of current week
  const day = d.getDay(); // 0=Sun,1=Mon...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

// Decorates a batch of matches with player names using one targeted query.
async function buildMatchResponses(matches: Array<typeof matchesTable.$inferSelect>) {
  const playerMap = await getPlayerNameMap(matches.flatMap((m) => [m.player1Id, m.player2Id]));
  return matches.map((m) => formatMatch(m, playerMap));
}

function formatMatch(m: typeof matchesTable.$inferSelect, playerMap: Record<number, string>) {
  return {
    ...m,
    player1Name: playerMap[m.player1Id] ?? "Unknown",
    player2Name: playerMap[m.player2Id] ?? "Unknown",
    location: m.location ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// POST /scheduling/:leagueId/generate — trigger generation
router.post("/scheduling/:leagueId/generate", requireAdmin, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    const weekOf = getWeekOf(req.body?.weekOf);

    const { matches, stats } = await generateWeeklyMatches(leagueId, weekOf);
    const saved = await saveGeneratedMatches(leagueId, weekOf, matches, stats, 0);

    // Notify league admins
    const { userId } = getAuth(req);
    // (notification goes to admin who triggered it — could expand to all admins)

    res.json({ success: true, weekOf, matchesGenerated: saved.length, stats });
  } catch (err: any) {
    console.error("Generate error:", err);
    res.status(500).json({ error: "Failed to generate schedule" });
  }
});

// GET /scheduling/:leagueId/suggestions — matchup suggestions ranked by time since last played
router.get("/scheduling/:leagueId/suggestions", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league" }); return; }

    const { userId } = getAuth(req);

    // Require league creator or league member
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!league) { res.status(404).json({ error: "League not found" }); return; }

    const isCreator = league.createdByClerkUserId === userId;
    if (!isCreator) {
      const memberRows = await db.select().from(playersTable)
        .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId!)));
      if (!memberRows.length) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId));
    if (players.length < 2) { res.json([]); return; }

    const completedMatches = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, leagueId), eq(matchesTable.status, "completed")))
      .orderBy(desc(matchesTable.completedAt));

    const pairLastPlayed = new Map<string, Date>();
    for (const m of completedMatches) {
      const pairKey = [m.player1Id, m.player2Id].sort().join("-");
      const matchDate = new Date(m.completedAt ?? m.updatedAt);
      if (!pairLastPlayed.has(pairKey)) pairLastPlayed.set(pairKey, matchDate);
    }

    const now = Date.now();
    const suggestions: Array<{
      player1Id: number; player1Name: string;
      player2Id: number; player2Name: string;
      daysSincePlayed: number | null;
    }> = [];

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const p1 = players[i];
        const p2 = players[j];
        const pairKey = [p1.id, p2.id].sort().join("-");
        const lastPlayed = pairLastPlayed.get(pairKey) ?? null;
        const daysSincePlayed = lastPlayed
          ? Math.floor((now - lastPlayed.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        suggestions.push({ player1Id: p1.id, player1Name: p1.name, player2Id: p2.id, player2Name: p2.name, daysSincePlayed });
      }
    }

    suggestions.sort((a, b) => {
      if (a.daysSincePlayed === null && b.daysSincePlayed === null) return 0;
      if (a.daysSincePlayed === null) return -1;
      if (b.daysSincePlayed === null) return 1;
      return b.daysSincePlayed - a.daysSincePlayed;
    });

    res.json(suggestions.slice(0, 12));
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

// GET /scheduling/:leagueId/log — get generation log history (must stay before :weekOf)
router.get("/scheduling/:leagueId/log", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    const logs = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(and(eq(scheduleGenerationLogsTable.leagueId, leagueId), isScheduleStatus()));
    res.json(logs);
  } catch {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// GET /scheduling/:leagueId/:weekOf — view proposed schedule
router.get("/scheduling/:leagueId/:weekOf", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    const weekOf = req.params.weekOf;

    const log = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(and(eq(scheduleGenerationLogsTable.leagueId, leagueId), eq(scheduleGenerationLogsTable.weekOf, weekOf), isScheduleStatus()));

    const matchRows = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, leagueId), eq(matchesTable.weekOf, weekOf)));

    const matchesWithDetails = await buildMatchResponses(matchRows);

    res.json({
      log: log[0] ?? null,
      matches: matchesWithDetails,
      weekOf,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

// POST /scheduling/:leagueId/confirm — confirm schedule + send notifications
router.post("/scheduling/:leagueId/confirm", requireAdmin, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    const weekOf = getWeekOf(req.body?.weekOf);
    const { userId } = getAuth(req);

    const log = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(and(eq(scheduleGenerationLogsTable.leagueId, leagueId), eq(scheduleGenerationLogsTable.weekOf, weekOf), isScheduleStatus()));

    if (!log.length) { res.status(404).json({ error: "No schedule found for this week" }); return; }

    await db.update(scheduleGenerationLogsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), confirmedByClerkUserId: userId })
      .where(eq(scheduleGenerationLogsTable.id, log[0].id));

    // Gather all players in this week's matches to notify them
    const weekMatches = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, leagueId), eq(matchesTable.weekOf, weekOf)));

    const playerIds = new Set<number>();
    for (const m of weekMatches) {
      playerIds.add(m.player1Id);
      playerIds.add(m.player2Id);
    }

    if (playerIds.size) {
      const players = await db
        .select({ clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(eq(playersTable.leagueId, leagueId));

      const clerkIds = players
        .filter((p) => p.clerkUserId)
        .map((p) => p.clerkUserId!);

      if (clerkIds.length) {
        try {
          await sendPushToUsers(clerkIds, "Your matches are scheduled!", `Check your upcoming matches for the week of ${weekOf}.`, "/matches");
        } catch {
          // Non-fatal — schedule still confirmed
        }
      }
    }

    res.json({ success: true, weekOf, status: "confirmed" });
  } catch {
    res.status(500).json({ error: "Failed to confirm schedule" });
  }
});

// POST /scheduling/:leagueId/regenerate — delete and re-generate
router.post("/scheduling/:leagueId/regenerate", requireAdmin, async (req, res) => {
  try {
    const leagueId = parseInt(String(req.params.leagueId));
    const weekOf = getWeekOf(req.body?.weekOf);

    const existingLog = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(and(eq(scheduleGenerationLogsTable.leagueId, leagueId), eq(scheduleGenerationLogsTable.weekOf, weekOf), isScheduleStatus()));

    const regenerationCount = (existingLog[0]?.regenerationCount ?? 0) + 1;

    const { matches, stats } = await generateWeeklyMatches(leagueId, weekOf);
    const saved = await saveGeneratedMatches(leagueId, weekOf, matches, stats, regenerationCount);

    res.json({ success: true, weekOf, matchesGenerated: saved.length, regenerationCount, stats });
  } catch {
    res.status(500).json({ error: "Failed to regenerate schedule" });
  }
});

export default router;
