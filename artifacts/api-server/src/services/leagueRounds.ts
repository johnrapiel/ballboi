// Weekly league rounds (spec: Leagues > Weekly loop; decision 29).
//
// Each week has one round, starting on the season's start weekday. The day
// before, the app drafts the pairings and tells the league's admins, who can
// swap players, mark byes, lock matches, or re-pair. On the start weekday
// morning the round goes out to players, whether or not an admin touched it,
// so a league never stalls waiting on its admin.

import {
  db,
  leagueAdminsTable,
  leagueRoundByesTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playerAvailabilityTable,
  playersTable,
  playoffBracketsTable,
  type League,
  type LeagueRound,
} from "@workspace/db";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { addDays, leagueToday, roundWindow, shortDate } from "../lib/leagueCalendar.js";
import {
  FLEX_WEIGHTS,
  ROUND_ROBIN_WEIGHTS,
  pairKey,
  pairRound,
  ratingValue,
  slotKeys,
  type PairingPlayer,
} from "../lib/pairing.js";
import { unpairedPlayers, type DraftRound } from "../lib/roundEdits.js";
import { logger } from "../lib/logger.js";
import { sendPushToUsers } from "../routes/notifications.js";
import { getAutoSeason } from "./seasonService.js";

/** Leagues the weekly engine runs: set up with the new league form, singles for now. */
export function usesWeeklyRounds(league: Pick<League, "seasonWeeks" | "startDate" | "format" | "leagueType">): boolean {
  return (
    !!league.seasonWeeks &&
    !!league.startDate &&
    (league.format === "flex" || league.format === "round_robin") &&
    league.leagueType === "singles"
  );
}

async function activePlayers(leagueId: number) {
  return db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)))
    .orderBy(asc(playersTable.id));
}

/** Everything about a round an admin can edit, in the shape the edit rules use. */
export async function loadDraftRound(round: LeagueRound): Promise<DraftRound> {
  const [matches, byes, players] = await Promise.all([
    db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.roundId, round.id), isNull(matchesTable.voidedAt))),
    db.select().from(leagueRoundByesTable).where(eq(leagueRoundByesTable.roundId, round.id)),
    activePlayers(round.leagueId),
  ]);
  return {
    published: !!round.publishedAt,
    matches: matches.map((m) => ({ id: m.id, player1Id: m.player1Id, player2Id: m.player2Id, locked: m.locked })),
    byes: byes.map((b) => ({ playerId: b.playerId, setByAdmin: b.setByAdmin })),
    activePlayerIds: players.map((p) => p.id),
  };
}

/** How often each pair has met this league (any round, not voided), and each player's byes. */
async function leagueHistory(leagueId: number, excludeRoundId: number) {
  const [matches, byes] = await Promise.all([
    db
      .select({ p1: matchesTable.player1Id, p2: matchesTable.player2Id, roundId: matchesTable.roundId })
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, leagueId), isNull(matchesTable.voidedAt), isNull(matchesTable.playoffBracketId))),
    db
      .select({ playerId: leagueRoundByesTable.playerId, roundId: leagueRoundByesTable.roundId })
      .from(leagueRoundByesTable)
      .innerJoin(leagueRoundsTable, eq(leagueRoundsTable.id, leagueRoundByesTable.roundId))
      .where(eq(leagueRoundsTable.leagueId, leagueId)),
  ]);
  const history = new Map<string, number>();
  for (const m of matches) {
    if (m.roundId === excludeRoundId) continue;
    const key = pairKey(m.p1, m.p2);
    history.set(key, (history.get(key) ?? 0) + 1);
  }
  const byeCounts = new Map<number, number>();
  for (const b of byes) {
    if (b.roundId === excludeRoundId) continue;
    byeCounts.set(b.playerId, (byeCounts.get(b.playerId) ?? 0) + 1);
  }
  return { history, byeCounts };
}

/** Pairs everyone in the round who isn't locked into a match or given a bye by an admin. */
async function pairOpenPlayers(league: League, round: LeagueRound, playerIds: number[], keep: DraftRound) {
  if (playerIds.length === 0) return;
  const [players, availability, { history, byeCounts }] = await Promise.all([
    db.select().from(playersTable).where(inArray(playersTable.id, playerIds)),
    db
      .select()
      .from(playerAvailabilityTable)
      .where(and(eq(playerAvailabilityTable.leagueId, league.id), eq(playerAvailabilityTable.weekOf, round.startDate))),
    leagueHistory(league.id, round.id),
  ]);
  // Pairings already in this round count as history too, so nobody is paired twice.
  for (const m of keep.matches) history.set(pairKey(m.player1Id, m.player2Id), (history.get(pairKey(m.player1Id, m.player2Id)) ?? 0) + 1);

  const pairingPlayers: PairingPlayer[] = players.map((p) => ({
    id: p.id,
    rating: ratingValue(p.skillLevel),
    slots: slotKeys(availability.find((a) => a.playerId === p.id)?.slots),
    byes: byeCounts.get(p.id) ?? 0,
  }));
  const { pairs, byes } = pairRound({
    players: pairingPlayers,
    history,
    weights: league.format === "round_robin" ? ROUND_ROBIN_WEIGHTS : FLEX_WEIGHTS,
    roundNumber: round.roundNumber,
  });

  const season = await getAutoSeason(league.id);
  if (pairs.length) {
    await db.insert(matchesTable).values(
      pairs.map(([a, b]) => ({
        leagueId: league.id,
        player1Id: a,
        player2Id: b,
        status: "scheduled",
        generatedFrom: "round",
        weekOf: round.startDate,
        roundId: round.id,
        ...(season ? { season } : {}),
      })),
    );
  }
  if (byes.length) {
    await db.insert(leagueRoundByesTable).values(byes.map((playerId) => ({ roundId: round.id, playerId }))).onConflictDoNothing();
  }
}

/** The round row for `roundNumber`, creating it (unpublished) if it doesn't exist. */
async function roundRow(league: League, roundNumber: number): Promise<{ round: LeagueRound; created: boolean }> {
  const [existing] = await db
    .select()
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.leagueId, league.id), eq(leagueRoundsTable.roundNumber, roundNumber)));
  if (existing) return { round: existing, created: false };
  const w = roundWindow(league.startDate!, roundNumber);
  const [round] = await db
    .insert(leagueRoundsTable)
    .values({ leagueId: league.id, roundNumber, startDate: w.startDate, endDate: w.deadline, status: "upcoming", publishedAt: null })
    .returning();
  return { round, created: true };
}

/** Drafts round `roundNumber` if it doesn't exist yet. Returns the round and whether it was just drafted. */
export async function ensureDraft(league: League, roundNumber: number): Promise<{ round: LeagueRound; drafted: boolean } | null> {
  const players = await activePlayers(league.id);
  if (players.length < 2) return null;
  const { round, created } = await roundRow(league, roundNumber);
  if (!created) return { round, drafted: false };
  await pairOpenPlayers(league, round, players.map((p) => p.id), { published: false, matches: [], byes: [], activePlayerIds: [] });
  return { round, drafted: true };
}

/** Re-pairs a draft round, keeping locked matches and admin byes. */
export async function repairRound(league: League, round: LeagueRound): Promise<void> {
  if (round.publishedAt) throw new Error("This round has already gone out to players.");
  await db.delete(matchesTable).where(and(eq(matchesTable.roundId, round.id), eq(matchesTable.locked, false)));
  await db.delete(leagueRoundByesTable).where(and(eq(leagueRoundByesTable.roundId, round.id), eq(leagueRoundByesTable.setByAdmin, false)));
  const kept = await loadDraftRound(round);
  await pairOpenPlayers(league, round, unpairedPlayers(kept), kept);
}

/** Sends a round out to players: pairs anyone left unpaired, then notifies everyone. */
export async function publishRound(league: League, round: LeagueRound): Promise<void> {
  if (round.publishedAt) return;
  const draft = await loadDraftRound(round);
  await pairOpenPlayers(league, round, unpairedPlayers(draft), draft);

  const [published] = await db
    .update(leagueRoundsTable)
    .set({ publishedAt: new Date(), status: round.startDate <= leagueToday() ? "active" : "upcoming" })
    .where(and(eq(leagueRoundsTable.id, round.id), isNull(leagueRoundsTable.publishedAt)))
    .returning();
  if (!published) return; // Someone else published it first.

  const [matches, byes, players] = await Promise.all([
    db.select().from(matchesTable).where(and(eq(matchesTable.roundId, round.id), isNull(matchesTable.voidedAt))),
    db.select().from(leagueRoundByesTable).where(eq(leagueRoundByesTable.roundId, round.id)),
    activePlayers(league.id),
  ]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const title = `Round ${round.roundNumber} pairings are out`;
  const sends: Promise<void>[] = [];
  for (const m of matches) {
    for (const [me, them] of [[m.player1Id, m.player2Id], [m.player2Id, m.player1Id]] as const) {
      const clerk = byId.get(me)?.clerkUserId;
      if (!clerk) continue;
      sends.push(
        sendPushToUsers(
          [clerk],
          title,
          `You're playing ${byId.get(them)?.name ?? "your opponent"}. Play by ${shortDate(round.endDate)}.`,
          `/league/${league.id}`,
        ).catch(() => {}),
      );
    }
  }
  for (const b of byes) {
    const clerk = byId.get(b.playerId)?.clerkUserId;
    if (clerk) sends.push(sendPushToUsers([clerk], title, "You have a bye this week.", `/league/${league.id}`).catch(() => {}));
  }
  await Promise.all(sends);
}

async function notifyAdminsOfDraft(league: League, round: LeagueRound) {
  const admins = await db
    .select({ clerkUserId: leagueAdminsTable.clerkUserId })
    .from(leagueAdminsTable)
    .where(eq(leagueAdminsTable.leagueId, league.id));
  const ids = admins.map((a) => a.clerkUserId);
  if (!ids.length) return;
  await sendPushToUsers(
    ids,
    `Review Round ${round.roundNumber} pairings`,
    `They go out ${shortDate(round.startDate)} morning. Swap players, mark byes, or lock matches in Manage.`,
    `/league/${league.id}/manage`,
  ).catch(() => {});
}

/**
 * The weekly loop for one league, run each morning: drafts tomorrow's round
 * for admin review, sends out any round that starts today or earlier, and
 * keeps round and league statuses in step with the calendar.
 */
export async function runLeagueDay(league: League, today: string = leagueToday()): Promise<void> {
  if (!usesWeeklyRounds(league)) return;
  const weeks = league.seasonWeeks!;
  const start = league.startDate!;
  const lastRound = roundWindow(start, weeks);

  // Round statuses follow the calendar.
  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, league.id));
  for (const r of rounds) {
    if (!r.publishedAt) continue;
    const status = today > r.endDate ? "completed" : today >= r.startDate ? "active" : "upcoming";
    if (status !== r.status) await db.update(leagueRoundsTable).set({ status }).where(eq(leagueRoundsTable.id, r.id));
  }

  // League status: upcoming until the start, active through the last grace week.
  if (today < start) {
    if (league.status !== "upcoming") await db.update(leaguesTable).set({ status: "upcoming" }).where(eq(leaguesTable.id, league.id));
  } else if (today <= lastRound.graceEnd) {
    if (league.status !== "active") await db.update(leaguesTable).set({ status: "active" }).where(eq(leaguesTable.id, league.id));
  } else {
    const [playoffs] = await db
      .select({ id: playoffBracketsTable.id })
      .from(playoffBracketsTable)
      .where(and(eq(playoffBracketsTable.leagueId, league.id), eq(playoffBracketsTable.status, "active")));
    if (!playoffs && league.status !== "completed") {
      await db.update(leaguesTable).set({ status: "completed" }).where(eq(leaguesTable.id, league.id));
    }
    return;
  }

  for (let n = 1; n <= weeks; n++) {
    const w = roundWindow(start, n);
    if (w.startDate > addDays(today, 1)) break;
    const existing = rounds.find((r) => r.roundNumber === n);
    if (existing?.publishedAt) continue;
    if (w.startDate === addDays(today, 1)) {
      // Tomorrow's round: draft it and let the admins know.
      const result = await ensureDraft(league, n);
      if (result?.drafted) await notifyAdminsOfDraft(league, result.round);
    } else if (w.deadline >= today) {
      // Starts today, or started and was never sent: send it now. Rounds whose
      // deadline already passed without pairings are skipped.
      const result = await ensureDraft(league, n);
      if (result) await publishRound(league, result.round);
    }
  }
}

/** Runs the weekly loop for every league that uses it. */
export async function runAllLeagueDays(): Promise<void> {
  const leagues = await db.select().from(leaguesTable).where(isNotNull(leaguesTable.seasonWeeks));
  const today = leagueToday();
  for (const league of leagues) {
    try {
      await runLeagueDay(league, today);
    } catch (err) {
      logger.error({ err, leagueId: league.id }, "League day failed");
    }
  }
}

