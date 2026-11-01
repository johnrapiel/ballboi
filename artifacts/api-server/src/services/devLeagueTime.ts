// Dev-only time controls for a league (walkthroughs and testing). Moves the
// league's dates earlier, which is the same as the calendar moving forward
// for that league only. Never runs pairing or publishing by itself: use
// "Run Flex pairing now", then send the round from the review screen.
// Rules live in lib/devTime.ts.

import { db, leagueRoundsTable, leaguesTable, matchesTable, seasonsTable, type League } from "@workspace/db";
import { eq } from "drizzle-orm";
import { earlier, earlierTime, planShift, type TimeAction } from "../lib/devTime.js";
import { leagueToday } from "../lib/leagueCalendar.js";
import { draftNextRound, syncLeagueStatus, syncRoundStatuses, usesWeeklyRounds } from "./leagueRounds.js";

export interface TimeResult {
  ok: boolean;
  message: string;
  days: number;
}

/** Moves every date of the league `days` earlier: season, rounds, matches, and its own seasons. */
export async function shiftLeagueEarlier(league: League, days: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(leaguesTable)
      .set({
        startDate: league.startDate ? earlier(league.startDate, days) : league.startDate,
        endDate: league.endDate ? earlier(league.endDate, days) : league.endDate,
      })
      .where(eq(leaguesTable.id, league.id));

    const rounds = await tx.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, league.id));
    for (const r of rounds) {
      await tx
        .update(leagueRoundsTable)
        .set({ startDate: earlier(r.startDate, days), endDate: earlier(r.endDate, days) })
        .where(eq(leagueRoundsTable.id, r.id));
    }

    const matches = await tx.select().from(matchesTable).where(eq(matchesTable.leagueId, league.id));
    for (const m of matches) {
      await tx
        .update(matchesTable)
        .set({
          weekOf: m.weekOf ? earlier(m.weekOf, days) : m.weekOf,
          scheduledAt: earlierTime(m.scheduledAt, days),
        })
        .where(eq(matchesTable.id, m.id));
    }

    const seasons = await tx.select().from(seasonsTable).where(eq(seasonsTable.leagueId, league.id));
    for (const s of seasons) {
      await tx
        .update(seasonsTable)
        .set({ startDate: earlier(s.startDate, days), endDate: earlier(s.endDate, days) })
        .where(eq(seasonsTable.id, s.id));
    }
  });
}

/** Applies a time jump, then brings round and league statuses in line with the new dates. */
export async function applyTimeAction(leagueId: number, action: TimeAction, today: string = leagueToday()): Promise<TimeResult> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return { ok: false, message: "League not found.", days: 0 };
  if (!usesWeeklyRounds(league)) return { ok: false, message: "Time controls work on singles Flex and Round robin leagues.", days: 0 };

  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId));
  const plan = planShift(action, {
    today,
    startDate: league.startDate,
    rounds: rounds.map((r) => ({ roundNumber: r.roundNumber, startDate: r.startDate, endDate: r.endDate, published: !!r.publishedAt })),
  });
  if ("error" in plan) return { ok: false, message: plan.error, days: 0 };

  await shiftLeagueEarlier(league, plan.days);
  const [moved] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  await syncRoundStatuses(await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId)), today);
  await syncLeagueStatus(moved, today);
  return { ok: true, message: plan.message, days: plan.days };
}

/** Drafts the next round now, for the admin to review and send. */
export async function pairNow(leagueId: number): Promise<{ ok: true; roundId: number; roundNumber: number; message: string } | { ok: false; message: string }> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return { ok: false, message: "League not found." };
  const result = await draftNextRound(league);
  if ("error" in result) return { ok: false, message: result.error };
  const { round } = result;
  return {
    ok: true,
    roundId: round.id,
    roundNumber: round.roundNumber,
    message: round.publishedAt
      ? `Round ${round.roundNumber} is already out.`
      : `Round ${round.roundNumber} is paired. Review it, then send it to players.`,
  };
}
