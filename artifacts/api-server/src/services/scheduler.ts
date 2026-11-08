import cron from "node-cron";
import { db, leaguesTable, scheduleGenerationLogsTable, playersTable, leagueRoundsTable, playoffBracketsTable } from "@workspace/db";
import { eq, and, desc, asc, isNull } from "drizzle-orm";
import { generateWeeklyMatches, saveGeneratedMatches } from "./matchGeneration";
import { generateAllRounds } from "./roundPairing";
import { sendPushToUsers } from "../routes/notifications";
import { logger } from "../lib/logger";
import { retryFailedBallBoiSessions } from "./ballBoiRetry";
import { failStuckAnalyses } from "./ballBoiStuck";
import { runAllLeagueDays } from "./leagueRounds";
import { sweepSessionVideos } from "../lib/videoRetention";
import { runMatchReminders } from "./push/matchReminderJob";
import { startMatchPlanJobs } from "./discover/matchPlanJobs";

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

// Leagues made before the new league form (no season length). Only these use
// the legacy round and schedule generators; newer leagues run the weekly loop
// in services/leagueRounds.ts.
async function getLegacyActiveLeagueIds(): Promise<number[]> {
  const leagues = await db
    .select({ id: leaguesTable.id })
    .from(leaguesTable)
    .where(and(eq(leaguesTable.status, "active"), isNull(leaguesTable.seasonWeeks)));
  return leagues.map((l) => l.id);
}

// Auto-generate schedules for all active leagues on Thursday 9AM
async function autoGenerateSchedules() {
  logger.info("CRON: Running Thursday schedule auto-generation");
  const leagueIds = await getLegacyActiveLeagueIds();
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

// Match day reminders (Wave 2, Session G; decision 127) run every 5 minutes
// from services/push/matchReminderJob.ts: the day-before at 8 AM on the
// match's clock, 2 hours before, and the Sunday nudge for league matches with
// no set time. The Wednesday "set your availability" reminder and the old
// Sunday and day-before jobs are gone.

async function autoGenerateRounds() {
  logger.info("CRON: Running daily round promotion check");
  const leagueIds = await getLegacyActiveLeagueIds();
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
  // Discover match cards: day-before, 2-hour and "Did it happen?" (Wave 2, Session F).
  startMatchPlanJobs();
  // Daily at midnight — auto-generate next rounds for leagues whose current round has expired
  cron.schedule("0 0 * * *", autoGenerateRounds, {
    timezone: "America/New_York",
  });

  // Hourly — weekly league loop: at 7:00 AM on each league's own clock, draft
  // tomorrow's pairings for admin review and send out rounds that start today
  // (spec: Leagues > Weekly loop). Leagues run on their creator's time zone.
  cron.schedule("0 * * * *", () => {
    runAllLeagueDays().catch((err) => logger.error({ err }, "CRON: League day failed"));
  });

  // Thursday at 9:00 AM — auto-generate availability-based schedules
  cron.schedule("0 9 * * 4", autoGenerateSchedules, {
    timezone: "America/New_York",
  });

  // Every 5 minutes — match day reminders: the day-before at 8 AM on the
  // match's clock, 2 hours before, and Sunday 9 AM for league matches with no
  // set time. Each at most once (decision 127).
  cron.schedule("*/5 * * * *", () => {
    void runMatchReminders(new Date(), sendPushToUsers);
  });

  // Every minute — retry Ball Boi sessions that failed due to ML service unavailability
  cron.schedule("* * * * *", () => {
    retryFailedBallBoiSessions().catch((err) => {
      logger.error({ err }, "BallBoi retry job threw an unexpected error");
    });
  });

  // Every 5 minutes — an analysis that never heard back from the ML server
  // turns to failed within an hour instead of "Analyzing" forever (D11)
  cron.schedule("*/5 * * * *", () => {
    failStuckAnalyses().catch((err) => logger.error({ err }, "CRON: Stuck analysis sweep failed"));
  });

  // Hourly at :17 — delete match video the spec says not to keep (raw uploads
  // after analysis, training copies once a player turns training off)
  cron.schedule("17 * * * *", () => {
    sweepSessionVideos().catch((err) => logger.error({ err }, "CRON: Video retention sweep failed"));
  });

  logger.info("Scheduler started: 7AM league time (league rounds), Thu 9AM (auto-generate), every 5min (match day reminders: 8AM day before, 2h before, Sun 9AM nudge), every 1min (Ball Boi retry), every 5min (stuck analysis), hourly (video retention)");
}
