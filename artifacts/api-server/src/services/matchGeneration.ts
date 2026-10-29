import { db, matchesTable, playerAvailabilityTable, scheduleGenerationLogsTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { blockedPlayerPairs, pairKey as blockPairKey } from "../lib/blocks.js";

const REMATCH_DAYS = 21;

function getWeekDates(weekOf: string): Date[] {
  const base = new Date(weekOf);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function scheduledAtFromDayHour(weekOf: string, dayOfWeek: number, hour: number): string {
  const dates = getWeekDates(weekOf);
  const d = dates[dayOfWeek];
  const hh = String(hour).padStart(2, "0");
  return `${d.toISOString().slice(0, 10)}T${hh}:00`;
}

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff / (1000 * 60 * 60 * 24);
}

interface PlayerWithAvail {
  playerId: number;
  slots: Array<{ dayOfWeek: number; hour: number }>;
}

export async function generateWeeklyMatches(leagueId: number, weekOf: string) {
  // Get all player availabilities for this week
  const availabilities = await db
    .select()
    .from(playerAvailabilityTable)
    .where(and(eq(playerAvailabilityTable.leagueId, leagueId), eq(playerAvailabilityTable.weekOf, weekOf)));

  if (!availabilities.length) {
    return { matches: [], stats: { timeSlotsAnalyzed: 0, playersWithAvailability: 0, pairsConsidered: 0, rematches_skipped: 0 } };
  }

  // Get recent matches to prevent rematches
  const recentMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.leagueId, leagueId));

  // Build a set of recently played pairs (within 21 days)
  const recentPairs = new Set<string>();
  for (const m of recentMatches) {
    if (!m.scheduledAt) continue;
    if (daysSince(m.scheduledAt) <= REMATCH_DAYS) {
      const key = [m.player1Id, m.player2Id].sort().join("-");
      recentPairs.add(key);
    }
  }

  // Never auto-schedule two players when either has blocked the other.
  const blockedPairs = await blockedPlayerPairs([...new Set(availabilities.map((a) => a.playerId))]);

  // Build player data structures
  const players: PlayerWithAvail[] = availabilities.map((a) => {
    return {
      playerId: a.playerId,
      slots: (a.slots as Array<{ dayOfWeek: number; hour: number }>) ?? [],
    };
  });

  // Group slots by dayOfWeek + hour
  const slotMap = new Map<string, number[]>();
  for (const p of players) {
    for (const slot of p.slots) {
      const key = `${slot.dayOfWeek}:${slot.hour}`;
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key)!.push(p.playerId);
    }
  }

  // Filter slots with 2+ players
  const commonSlots = [...slotMap.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([key, ids]) => ({ key, dayOfWeek: parseInt(key.split(":")[0]), hour: parseInt(key.split(":")[1]), playerIds: ids }));

  const matchedInSlot = new Set<string>(); // "slotKey:playerId"
  const generatedMatches: Array<{
    player1Id: number; player2Id: number; scheduledAt: string;
    weekOf: string; leagueId: number; generatedFrom: string;
  }> = [];

  let pairsConsidered = 0;
  let rematchesSkipped = 0;

  for (const slot of commonSlots) {
    const available = slot.playerIds.filter((id) => !matchedInSlot.has(`${slot.key}:${id}`));

    for (let i = 0; i < available.length - 1; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const p1Id = available[i];
        const p2Id = available[j];
        pairsConsidered++;

        // Check rematch prevention
        const pairKey = [p1Id, p2Id].sort().join("-");
        if (recentPairs.has(pairKey)) { rematchesSkipped++; continue; }
        if (blockedPairs.has(blockPairKey(p1Id, p2Id))) continue;

        // Check neither player already scheduled in this slot
        if (matchedInSlot.has(`${slot.key}:${p1Id}`) || matchedInSlot.has(`${slot.key}:${p2Id}`)) continue;

        generatedMatches.push({
          player1Id: p1Id,
          player2Id: p2Id,
          scheduledAt: scheduledAtFromDayHour(weekOf, slot.dayOfWeek, slot.hour),
          weekOf,
          leagueId,
          generatedFrom: "auto",
        });

        matchedInSlot.add(`${slot.key}:${p1Id}`);
        matchedInSlot.add(`${slot.key}:${p2Id}`);
      }
    }
  }

  return {
    matches: generatedMatches,
    stats: {
      timeSlotsAnalyzed: commonSlots.length,
      playersWithAvailability: players.length,
      pairsConsidered,
      rematches_skipped: rematchesSkipped,
    },
  };
}

export async function saveGeneratedMatches(
  leagueId: number,
  weekOf: string,
  matches: Awaited<ReturnType<typeof generateWeeklyMatches>>["matches"],
  stats: Awaited<ReturnType<typeof generateWeeklyMatches>>["stats"],
  regenerationCount = 0
) {
  // Delete previously auto-generated matches for this week/league
  const existing = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(and(eq(matchesTable.leagueId, leagueId), eq(matchesTable.weekOf, weekOf)));

  for (const m of existing) {
    await db.delete(matchesTable).where(eq(matchesTable.id, m.id));
  }

  // Insert new matches
  const inserted = [];
  for (const m of matches) {
    const [row] = await db.insert(matchesTable).values({
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      leagueId: m.leagueId,
      scheduledAt: m.scheduledAt,
      location: null,
      weekOf: m.weekOf,
      generatedFrom: "auto",
      status: "scheduled",
    }).returning();
    inserted.push(row);
  }

  // Upsert log
  const existingLog = await db
    .select()
    .from(scheduleGenerationLogsTable)
    .where(and(
      eq(scheduleGenerationLogsTable.leagueId, leagueId),
      eq(scheduleGenerationLogsTable.weekOf, weekOf),
      or(
        eq(scheduleGenerationLogsTable.status, "pending_review"),
        eq(scheduleGenerationLogsTable.status, "confirmed")
      )
    ));

  if (existingLog.length) {
    await db.update(scheduleGenerationLogsTable)
      .set({
        status: "pending_review",
        generatedAt: new Date(),
        regenerationCount,
        matchesGenerated: inserted.length,
        stats,
      })
      .where(eq(scheduleGenerationLogsTable.id, existingLog[0].id));
  } else {
    await db.insert(scheduleGenerationLogsTable).values({
      leagueId,
      weekOf,
      status: "pending_review",
      regenerationCount,
      matchesGenerated: inserted.length,
      stats,
    });
  }

  return inserted;
}
