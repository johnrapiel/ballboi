import cron from "node-cron";
import { db, leaguesTable, scheduleGenerationLogsTable, matchesTable, playersTable, playerAvailabilityTable, matchRemindersLogTable, leagueRoundsTable, playoffBracketsTable } from "@workspace/db";
import { eq, and, gte, lt, inArray, desc, asc } from "drizzle-orm";
import { generateWeeklyMatches, saveGeneratedMatches } from "./matchGeneration";
import { generateAllRounds } from "./roundPairing";
import { sendPushToUsers } from "../routes/notifications";
import { logger } from "../lib/logger";
import { retryFailedBallBoiSessions } from "./ballBoiRetry";

function getMondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getNextMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  // days until next Monday
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().slice(0, 10);
}

async function getActiveLeagueIds(): Promise<number[]> {
  const leagues = await db
    .select({ id: leaguesTable.id })
    .from(leaguesTable)
    .where(eq(leaguesTable.status, "active"));
  return leagues.map((l) => l.id);
}

// Auto-generate schedules for all active leagues on Thursday 9AM
async function autoGenerateSchedules() {
  logger.info("CRON: Running Thursday schedule auto-generation");
  const leagueIds = await getActiveLeagueIds();
  const weekOf = getNextMonday(new Date()); // Generate for next week

  for (const leagueId of leagueIds) {
    try {
      // Check if schedule already exists for this week
      const existing = await db
        .select()
        .from(scheduleGenerationLogsTable)
        .where(
          and(
            eq(scheduleGenerationLogsTable.leagueId, leagueId),
            eq(scheduleGenerationLogsTable.weekOf, weekOf)
          )
        );

      if (existing.length > 0 && existing[0].status !== "draft") {
        logger.info({ leagueId, weekOf }, "CRON: Schedule already exists, skipping");
        continue;
      }

      logger.info({ leagueId, weekOf }, "CRON: Generating matches");
      const result = await generateWeeklyMatches(leagueId, weekOf);
      await saveGeneratedMatches(leagueId, weekOf, result.matches, result.stats);

      logger.info(
        { leagueId, weekOf, matchesGenerated: result.matches.length },
        "CRON: Schedule generated"
      );

      // Notify admin(s)
      const adminPlayers = await db
        .select({ clerkUserId: playersTable.clerkUserId })
        .from(playersTable)
        .where(eq(playersTable.leagueId, leagueId));

      // In a real setup you'd look up admin by ADMIN_EMAIL; here we just send to all for demo
      if (adminPlayers.length > 0) {
        const adminUserIds = adminPlayers.map((p) => p.clerkUserId).filter(Boolean) as string[];
        await sendPushToUsers(
          adminUserIds,
          "Schedule Ready for Review",
          `${result.matches.length} matches generated for week of ${weekOf}. Review and confirm now.`,
          "/admin/schedule-review"
        );
      }
    } catch (err) {
      logger.error({ err, leagueId, weekOf }, "CRON: Failed to generate schedule for league");
    }
  }
}

// Wednesday 5PM reminder: notify players who haven't set availability
async function availabilityReminder() {
  logger.info("CRON: Running Wednesday availability reminder");
  const leagueIds = await getActiveLeagueIds();
  const weekOf = getMondayOf(new Date());

  for (const leagueId of leagueIds) {
    try {
      const allPlayers = await db
        .select()
        .from(playersTable)
        .where(eq(playersTable.leagueId, leagueId));

      const withAvailability = await db
        .select({ clerkUserId: playersTable.clerkUserId })
        .from(playerAvailabilityTable)
        .leftJoin(playersTable, eq(playerAvailabilityTable.playerId, playersTable.id))
        .where(
          and(
            eq(playerAvailabilityTable.leagueId, leagueId),
            eq(playerAvailabilityTable.weekOf, weekOf)
          )
        );

      const haveSet = new Set(withAvailability.map((r) => r.clerkUserId).filter(Boolean));
      const missing = allPlayers
        .filter((p) => p.clerkUserId && !haveSet.has(p.clerkUserId))
        .map((p) => p.clerkUserId as string);

      if (missing.length > 0) {
        await sendPushToUsers(
          missing,
          "Set Your Availability",
          "Deadline tonight at midnight — set your availability for this week's matches!",
          "/availability"
        );
        logger.info({ leagueId, reminderCount: missing.length }, "CRON: Sent availability reminders");
      }
    } catch (err) {
      logger.error({ err, leagueId }, "CRON: Failed to send availability reminders");
    }
  }
}

// Sunday 9AM: remind players about upcoming week matches
async function upcomingMatchesReminder() {
  logger.info("CRON: Running Sunday match reminders");
  const leagueIds = await getActiveLeagueIds();
  const nextMonday = getNextMonday(new Date());
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextSunday.getDate() + 6);
  const nextSundayStr = nextSunday.toISOString().slice(0, 10);

  for (const leagueId of leagueIds) {
    try {
      const confirmedLog = await db
        .select()
        .from(scheduleGenerationLogsTable)
        .where(
          and(
            eq(scheduleGenerationLogsTable.leagueId, leagueId),
            eq(scheduleGenerationLogsTable.weekOf, nextMonday),
            eq(scheduleGenerationLogsTable.status, "confirmed")
          )
        );

      if (!confirmedLog.length) continue;

      const upcomingMatches = await db
        .select()
        .from(matchesTable)
        .where(
          and(
            eq(matchesTable.leagueId, leagueId),
            eq(matchesTable.weekOf, nextMonday),
            eq(matchesTable.status, "scheduled")
          )
        );

      const playerIds = [
        ...upcomingMatches.map((m) => m.player1Id),
        ...upcomingMatches.map((m) => m.player2Id),
      ].filter((id): id is number => id !== null);

      if (!playerIds.length) continue;

      const players = await db
        .select()
        .from(playersTable)
        .where(eq(playersTable.leagueId, leagueId));

      const userIds = players
        .filter((p) => playerIds.includes(p.id) && p.clerkUserId)
        .map((p) => p.clerkUserId as string);

      if (userIds.length > 0) {
        await sendPushToUsers(
          userIds,
          "Upcoming Matches This Week",
          `You have a match scheduled for the week of ${nextMonday}. Check the schedule for details.`,
          "/matches"
        );
        logger.info({ leagueId, notified: userIds.length }, "CRON: Sent upcoming match reminders");
      }
    } catch (err) {
      logger.error({ err, leagueId }, "CRON: Failed to send match reminders");
    }
  }
}

// Returns the UTC timestamp for midnight of a given "YYYY-MM-DD" date in the ET timezone.
// Tries UTC-4 (EDT) and UTC-5 (EST) and picks whichever lands on 00:00 ET for that date.
function getUTCForETMidnight(etDateStr: string): Date {
  for (const offsetHours of [4, 5]) {
    const [year, month, day] = etDateStr.split("-").map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day, offsetHours, 0, 0, 0));
    const dateCheck = candidate.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const timeCheck = candidate.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    if (dateCheck === etDateStr && timeCheck === "00:00") {
      return candidate;
    }
  }
  // Fallback: treat as UTC-5 (EST)
  const [year, month, day] = etDateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
}

// Returns the UTC ISO range for "tomorrow" in America/New_York timezone (half-open: [start, end))
function getTomorrowRangeET(): { windowStart: string; windowEnd: string; reminderForDate: string } {
  const now = new Date();

  // Get tomorrow's calendar date in ET, then the day after.
  // Adding 24h is always safe for finding the next calendar day (DST shift is only ±1h).
  const tomorrowDateET = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // "YYYY-MM-DD"
  const dayAfterDateET = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const windowStart = getUTCForETMidnight(tomorrowDateET);
  const windowEnd = getUTCForETMidnight(dayAfterDateET);

  return { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), reminderForDate: tomorrowDateET };
}

// Daily 8AM: send day-before match reminders to players with a match the following day
async function dayBeforeMatchReminder() {
  logger.info("CRON: Running day-before match reminders");

  // Target the full calendar day of "tomorrow" in ET
  const { windowStart: windowStartStr, windowEnd: windowEndStr, reminderForDate } = getTomorrowRangeET();
  logger.info({ windowStart: windowStartStr, windowEnd: windowEndStr, reminderForDate }, "CRON: Day-before reminder window");

  try {
    // Fetch only scheduled matches whose scheduledAt falls within tomorrow (ET)
    const tomorrowMatches = await db
      .select()
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.status, "scheduled"),
          gte(matchesTable.scheduledAt, windowStartStr),
          lt(matchesTable.scheduledAt, windowEndStr)
        )
      );

    if (!tomorrowMatches.length) {
      logger.info("CRON: No day-before matches to remind");
      return;
    }

    logger.info({ count: tomorrowMatches.length }, "CRON: Sending day-before reminders");

    const playerIdSet = new Set<number>();
    for (const m of tomorrowMatches) {
      playerIdSet.add(m.player1Id);
      playerIdSet.add(m.player2Id);
      if (m.player3Id) playerIdSet.add(m.player3Id);
      if (m.player4Id) playerIdSet.add(m.player4Id);
    }

    const playerIdList = Array.from(playerIdSet);

    const players = playerIdList.length > 0
      ? await db.select().from(playersTable).where(inArray(playersTable.id, playerIdList))
      : [];
    const playerMap: Record<number, typeof players[0]> = {};
    for (const p of players) playerMap[p.id] = p;

    for (const match of tomorrowMatches) {
      try {
        const [claimedReminder] = await db
          .insert(matchRemindersLogTable)
          .values({
            matchId: match.id,
            reminderType: "day_before_match",
            reminderForDate,
          })
          .onConflictDoNothing({
            target: [
              matchRemindersLogTable.matchId,
              matchRemindersLogTable.reminderType,
              matchRemindersLogTable.reminderForDate,
            ],
          })
          .returning({ id: matchRemindersLogTable.id });

        if (!claimedReminder) {
          logger.info({ matchId: match.id, reminderForDate }, "CRON: Day-before reminder already sent, skipping");
          continue;
        }

        const p1 = playerMap[match.player1Id];
        const p2 = playerMap[match.player2Id];
        const p3 = match.player3Id ? playerMap[match.player3Id] : null;
        const p4 = match.player4Id ? playerMap[match.player4Id] : null;
        const isDoubles = p3 != null && p4 != null;

        // Format match time
        const matchTime = new Date(match.scheduledAt!);
        const timeStr = matchTime.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/New_York",
        });

        const locationStr = match.location ?? "Location TBD";

        const matchLink = `/matches/${match.id}`;

        if (isDoubles) {
          // Doubles: send to all four players with their team vs opponent team info
          const team1Names = `${p1?.name ?? "Unknown"} & ${p3?.name ?? "Unknown"}`;
          const team2Names = `${p2?.name ?? "Unknown"} & ${p4?.name ?? "Unknown"}`;

          const team1Ids = [p1, p3]
            .filter((player) => player?.clerkUserId && player.dayBeforeMatchReminderEnabled)
            .map((player) => player!.clerkUserId as string);
          const team2Ids = [p2, p4]
            .filter((player) => player?.clerkUserId && player.dayBeforeMatchReminderEnabled)
            .map((player) => player!.clerkUserId as string);

          if (team1Ids.length > 0) {
            await sendPushToUsers(
              team1Ids,
              "Match Tomorrow",
              `vs ${team2Names} at ${timeStr}. ${locationStr}`,
              matchLink
            );
          }
          if (team2Ids.length > 0) {
            await sendPushToUsers(
              team2Ids,
              "Match Tomorrow",
              `vs ${team1Names} at ${timeStr}. ${locationStr}`,
              matchLink
            );
          }
        } else {
          // Singles: send to each player with their specific opponent
          if (p1?.clerkUserId && p1.dayBeforeMatchReminderEnabled) {
            await sendPushToUsers(
              [p1.clerkUserId],
              "Match Tomorrow",
              `vs ${p2?.name ?? "Unknown"} at ${timeStr}. ${locationStr}`,
              matchLink
            );
          }
          if (p2?.clerkUserId && p2.dayBeforeMatchReminderEnabled) {
            await sendPushToUsers(
              [p2.clerkUserId],
              "Match Tomorrow",
              `vs ${p1?.name ?? "Unknown"} at ${timeStr}. ${locationStr}`,
              matchLink
            );
          }
        }

        logger.info({ matchId: match.id, scheduledAt: match.scheduledAt, reminderForDate }, "CRON: Sent day-before reminder");
      } catch (err) {
        logger.error({ err, matchId: match.id }, "CRON: Failed to send day-before reminder for match");
      }
    }
  } catch (err) {
    logger.error({ err }, "CRON: Failed to run day-before match reminder job");
  }
}

async function autoGenerateRounds() {
  logger.info("CRON: Running daily round promotion check");
  const leagueIds = await getActiveLeagueIds();
  const today = new Date().toISOString().slice(0, 10);

  for (const leagueId of leagueIds) {
    try {
      const activePlayoffs = await db
        .select({ id: playoffBracketsTable.id })
        .from(playoffBracketsTable)
        .where(and(eq(playoffBracketsTable.leagueId, leagueId), eq(playoffBracketsTable.status, "active")));
      if (activePlayoffs.length > 0) {
        logger.info({ leagueId }, "CRON: Skipping — active playoff bracket exists");
        continue;
      }

      // Close any expired active rounds
      const activeRounds = await db
        .select()
        .from(leagueRoundsTable)
        .where(and(eq(leagueRoundsTable.leagueId, leagueId), eq(leagueRoundsTable.status, "active")))
        .orderBy(desc(leagueRoundsTable.roundNumber));

      const stillActive = activeRounds.filter((r) => r.endDate >= today);
      if (stillActive.length > 0) {
        // Current active round is still within its window — nothing to do
        continue;
      }

      for (const r of activeRounds) {
        await db.update(leagueRoundsTable).set({ status: "completed" }).where(eq(leagueRoundsTable.id, r.id));
      }

      // Promote the next upcoming round to active
      const nextUpcoming = await db
        .select()
        .from(leagueRoundsTable)
        .where(and(eq(leagueRoundsTable.leagueId, leagueId), eq(leagueRoundsTable.status, "upcoming")))
        .orderBy(asc(leagueRoundsTable.roundNumber))
        .limit(1);

      if (nextUpcoming.length > 0) {
        await db
          .update(leagueRoundsTable)
          .set({ status: "active" })
          .where(eq(leagueRoundsTable.id, nextUpcoming[0].id));
        logger.info({ leagueId, roundNumber: nextUpcoming[0].roundNumber }, "CRON: Promoted upcoming round to active");
        continue;
      }

      // No upcoming rounds queued — fall back to generating remaining rounds up to 6
      const totalRounds = await db
        .select()
        .from(leagueRoundsTable)
        .where(eq(leagueRoundsTable.leagueId, leagueId));
      if (totalRounds.length >= 6) {
        logger.info({ leagueId }, "CRON: All 6 rounds already generated");
        continue;
      }

      const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId));
      if (players.length < 2) continue;

      const newRounds = await generateAllRounds(leagueId, 6);
      logger.info({ leagueId, newRoundsGenerated: newRounds.length }, "CRON: Generated missing rounds");
    } catch (err) {
      logger.error({ err, leagueId }, "CRON: Failed to advance rounds");
    }
  }
}

export function startScheduler() {
  // Daily at midnight — auto-generate next rounds for leagues whose current round has expired
  cron.schedule("0 0 * * *", autoGenerateRounds, {
    timezone: "America/New_York",
  });

  // Thursday at 9:00 AM — auto-generate availability-based schedules
  cron.schedule("0 9 * * 4", autoGenerateSchedules, {
    timezone: "America/New_York",
  });

  // Wednesday at 5:00 PM — remind players to set availability
  cron.schedule("0 17 * * 3", availabilityReminder, {
    timezone: "America/New_York",
  });

  // Sunday at 9:00 AM — remind players about upcoming matches
  cron.schedule("0 9 * * 0", upcomingMatchesReminder, {
    timezone: "America/New_York",
  });

  // Daily at 8:00 AM — remind players about matches the next day
  cron.schedule("0 8 * * *", dayBeforeMatchReminder, {
    timezone: "America/New_York",
  });

  // Every minute — retry Ball Boi sessions that failed due to ML service unavailability
  cron.schedule("* * * * *", () => {
    retryFailedBallBoiSessions().catch((err) => {
      logger.error({ err }, "BallBoi retry job threw an unexpected error");
    });
  });

  logger.info("Scheduler started: Thu 9AM (auto-generate), Wed 5PM (availability reminder), Sun 9AM (match reminder), Daily 8AM (day-before reminder), every 1min (Ball Boi retry)");
}
