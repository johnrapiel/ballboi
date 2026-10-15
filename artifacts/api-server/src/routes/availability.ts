import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, playerAvailabilityTable, playersTable, leaguesTable, scheduleGenerationLogsTable } from "@workspace/db";
import { eq, and, desc, sql, or } from "drizzle-orm";
import { sendPushToUsers } from "./notifications";

const router = Router();
const REMINDER_COOLDOWN_HOURS = 6;

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function isLeagueAdmin(userId: string, leagueId: number): Promise<boolean> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return false;
  if (!league.createdByClerkUserId) return true;
  return league.createdByClerkUserId === userId;
}

function isReminderInCooldown(sentAt: Date) {
  const cutoff = Date.now() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000;
  return sentAt.getTime() > cutoff;
}

// GET /availability/:leagueId/:weekOf — get all availabilities for a league/week (admin or self)
router.get("/availability/:leagueId/:weekOf", requireAuth, async (req, res) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const weekOf = req.params.weekOf;
    const rows = await db
      .select()
      .from(playerAvailabilityTable)
      .where(and(eq(playerAvailabilityTable.leagueId, leagueId), eq(playerAvailabilityTable.weekOf, weekOf)));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch availabilities" });
  }
});

// GET /availability/me/:leagueId/:weekOf — get current player's availability
router.get("/availability/me/:leagueId/:weekOf", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const leagueId = parseInt(req.params.leagueId);
    const weekOf = req.params.weekOf;

    // Find player by clerkUserId in this league
    const players = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.clerkUserId, userId!), eq(playersTable.leagueId, leagueId)));

    if (!players.length) return res.json({ slots: [] });

    const playerId = players[0].id;
    const rows = await db
      .select()
      .from(playerAvailabilityTable)
      .where(and(
        eq(playerAvailabilityTable.playerId, playerId),
        eq(playerAvailabilityTable.leagueId, leagueId),
        eq(playerAvailabilityTable.weekOf, weekOf)
      ));

    res.json(rows[0] ?? { playerId, leagueId, weekOf, slots: [] });
  } catch {
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

// POST /availability — save player's weekly availability
router.post("/availability", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { leagueId, weekOf, slots, playerId: bodyPlayerId } = req.body;

    if (!leagueId || !weekOf) {
      return res.status(400).json({ error: "leagueId and weekOf required" });
    }

    // Resolve playerId from clerkUserId
    let playerId = bodyPlayerId;
    if (!playerId) {
      const players = await db
        .select()
        .from(playersTable)
        .where(and(eq(playersTable.clerkUserId, userId!), eq(playersTable.leagueId, leagueId)));
      if (!players.length) return res.status(404).json({ error: "Player not found in this league" });
      playerId = players[0].id;
    }

    // Upsert
    const existing = await db
      .select()
      .from(playerAvailabilityTable)
      .where(and(
        eq(playerAvailabilityTable.playerId, playerId),
        eq(playerAvailabilityTable.leagueId, leagueId),
        eq(playerAvailabilityTable.weekOf, weekOf)
      ));

    if (existing.length) {
      const [updated] = await db
        .update(playerAvailabilityTable)
        .set({ slots: slots ?? [] })
        .where(eq(playerAvailabilityTable.id, existing[0].id))
        .returning();
      return res.json(updated);
    }

    const [created] = await db
      .insert(playerAvailabilityTable)
      .values({ playerId, leagueId, weekOf, slots: slots ?? [] })
      .returning();
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to save availability" });
  }
});

// GET /availability/participation/:leagueId/:weekOf — all players with slot counts
router.get("/availability/participation/:leagueId/:weekOf", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const leagueId = parseInt(req.params.leagueId);
    const weekOf = req.params.weekOf;

    if (!(await isLeagueAdmin(userId!, leagueId))) {
      return res.status(403).json({ error: "Forbidden: league admin only" });
    }

    const players = await db
      .select()
      .from(playersTable)
      .where(eq(playersTable.leagueId, leagueId));

    const availRows = await db
      .select()
      .from(playerAvailabilityTable)
      .where(and(eq(playerAvailabilityTable.leagueId, leagueId), eq(playerAvailabilityTable.weekOf, weekOf)));

    const availMap = new Map<number, number>();
    for (const row of availRows) {
      const slots = Array.isArray(row.slots) ? row.slots : [];
      availMap.set(row.playerId, slots.length);
    }

    const [lastReminder] = await db
      .select()
      .from(scheduleGenerationLogsTable)
      .where(and(
        eq(scheduleGenerationLogsTable.leagueId, leagueId),
        eq(scheduleGenerationLogsTable.weekOf, weekOf),
        eq(scheduleGenerationLogsTable.status, "availability_reminder")
      ))
      .orderBy(desc(scheduleGenerationLogsTable.generatedAt))
      .limit(1);

    const result = players.map((p) => {
      const slotCount = availMap.get(p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        skillLevel: p.skillLevel,
        hasSubmitted: slotCount !== null,
        slotCount: slotCount ?? 0,
      };
    });

    res.json({
      players: result,
      lastReminder: lastReminder ? {
        id: lastReminder.id,
        sentAt: lastReminder.generatedAt,
        countSent: lastReminder.matchesGenerated ?? 0,
        missingCount: lastReminder.stats?.availabilityReminderMissingCount ?? 0,
      } : null,
      reminderCooldownHours: REMINDER_COOLDOWN_HOURS,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch participation" });
  }
});

// POST /availability/remind/:leagueId/:weekOf — push reminder to players who haven't submitted
router.post("/availability/remind/:leagueId/:weekOf", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const leagueId = parseInt(req.params.leagueId);
    const weekOf = req.params.weekOf;

    if (!(await isLeagueAdmin(userId!, leagueId))) {
      return res.status(403).json({ error: "Forbidden: league admin only" });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`availability-reminder:${leagueId}:${weekOf}`}))`);

      const [lastReminder] = await tx
        .select()
        .from(scheduleGenerationLogsTable)
        .where(and(
          eq(scheduleGenerationLogsTable.leagueId, leagueId),
          eq(scheduleGenerationLogsTable.weekOf, weekOf),
          or(
            eq(scheduleGenerationLogsTable.status, "availability_reminder"),
            eq(scheduleGenerationLogsTable.status, "availability_reminder_pending")
          )
        ))
        .orderBy(desc(scheduleGenerationLogsTable.generatedAt))
        .limit(1);
      if (lastReminder && isReminderInCooldown(lastReminder.generatedAt)) {
        return {
          blocked: true as const,
          lastReminder: {
            id: lastReminder.id,
            sentAt: lastReminder.generatedAt,
            countSent: lastReminder.matchesGenerated ?? 0,
            missingCount: lastReminder.stats?.availabilityReminderMissingCount ?? 0,
          },
        };
      }

      const players = await tx
        .select()
        .from(playersTable)
        .where(eq(playersTable.leagueId, leagueId));

      const availRows = await tx
        .select()
        .from(playerAvailabilityTable)
        .where(and(eq(playerAvailabilityTable.leagueId, leagueId), eq(playerAvailabilityTable.weekOf, weekOf)));

      const submittedPlayerIds = new Set(availRows.map((r) => r.playerId));
      const missingPlayers = players.filter((p) => !submittedPlayerIds.has(p.id));
      const clerkIds = missingPlayers.filter((p) => p.clerkUserId).map((p) => p.clerkUserId!);

      const [reminderLog] = await tx
        .insert(scheduleGenerationLogsTable)
        .values({
          leagueId,
          weekOf,
          status: "availability_reminder_pending",
          matchesGenerated: 0,
          confirmedByClerkUserId: userId,
          stats: {
            timeSlotsAnalyzed: 0,
            playersWithAvailability: availRows.length,
            pairsConsidered: 0,
            rematches_skipped: 0,
            availabilityReminderMissingCount: missingPlayers.length,
          },
        })
        .returning();

      return {
        blocked: false as const,
        reminderLogId: reminderLog.id,
        missingCount: missingPlayers.length,
        clerkIds,
        lastReminder: {
          id: reminderLog.id,
          sentAt: reminderLog.generatedAt,
          countSent: 0,
          missingCount: reminderLog.stats?.availabilityReminderMissingCount ?? 0,
        },
      };
    });

    if (result.blocked) {
      return res.status(409).json({
        error: `Availability reminders were already sent in the last ${REMINDER_COOLDOWN_HOURS} hours`,
        lastReminder: result.lastReminder,
        reminderCooldownHours: REMINDER_COOLDOWN_HOURS,
      });
    }

    let notified = 0;
    try {
      if (result.clerkIds.length) {
        await sendPushToUsers(
          result.clerkIds,
          "Set your availability!",
          `Please submit your availability for the week of ${weekOf} so you can be scheduled for matches.`,
          "/availability"
        );
        notified = result.clerkIds.length;
      }
    } catch (error) {
      await db
        .update(scheduleGenerationLogsTable)
        .set({ status: "availability_reminder_failed" })
        .where(eq(scheduleGenerationLogsTable.id, result.reminderLogId));
      throw error;
    }

    await db
      .update(scheduleGenerationLogsTable)
      .set({ status: "availability_reminder", matchesGenerated: notified })
      .where(eq(scheduleGenerationLogsTable.id, result.reminderLogId));

    res.json({
      success: true,
      missingCount: result.missingCount,
      notified,
      lastReminder: {
        ...result.lastReminder,
        countSent: notified,
      },
      reminderCooldownHours: REMINDER_COOLDOWN_HOURS,
    });
  } catch {
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

export default router;
