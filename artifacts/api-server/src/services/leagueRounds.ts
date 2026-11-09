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
import { addDays, leagueZone, localHour, roundMatchTime, roundWindow, shortDate, todayFor } from "../lib/leagueCalendar.js";
import {
  FLEX_WEIGHTS,
  ROUND_ROBIN_WEIGHTS,
  pairKey,
  pairRound,
  slotKeys,
  type PairingPlayer,
} from "../lib/pairing.js";
import { unpairedPlayers, type DraftRound } from "../lib/roundEdits.js";
import { blockedPlayerPairs } from "../lib/blocks.js";
import { logger } from "../lib/logger.js";
import { sendPushToUsers } from "../routes/notifications.js";
import { leagueChat } from "../messaging/leagueChatEvents.js";
import { loadProfiles, playerLevelValue } from "../lib/playerProfile.js";
import { getAutoSeason } from "./seasonService.js";
import { startPlayoffs } from "./leaguePlayoffs.js";
import { pairOpenDoubles } from "./doublesRounds.js";
import { openChatsForRound } from "./doublesChat.js";
import { MIN_DOUBLES_PLAYERS, firstName, isDoubles } from "../lib/doublesTeams.js";

/** Leagues the weekly engine runs: set up with the new league form, singles or doubles. */
export function usesWeeklyRounds(league: Pick<League, "seasonWeeks" | "startDate" | "format" | "leagueType">): boolean {
  return (
    !!league.seasonWeeks &&
    !!league.startDate &&
    (league.format === "flex" || league.format === "round_robin") &&
    (league.leagueType === "singles" || league.leagueType === "doubles")
  );
}

/** Players a league needs before it can pair a round: 4 for doubles (D8). */
export function minPlayers(league: Pick<League, "leagueType">): number {
  return isDoubles(league) ? MIN_DOUBLES_PLAYERS : 2;
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
    matches: matches.map((m) => ({
      id: m.id,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      player3Id: m.player3Id,
      player4Id: m.player4Id,
      locked: m.locked,
    })),
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
  if (isDoubles(league)) return pairOpenDoubles(league, round, playerIds);
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

  // Flex pairs on each player's current profile level (self-rated), never a
  // copy on the league row; placeholders use the level their admin set.
  const profiles = await loadProfiles(players.map((p) => p.clerkUserId));
  const pairingPlayers: PairingPlayer[] = players.map((p) => ({
    id: p.id,
    rating: playerLevelValue(p, profiles),
    slots: slotKeys(availability.find((a) => a.playerId === p.id)?.slots),
    byes: byeCounts.get(p.id) ?? 0,
  }));
  // B10: two players where either blocked the other are never paired.
  const blocked = await blockedPlayerPairs(players.map((p) => p.id));
  const { pairs, byes } = pairRound({
    players: pairingPlayers,
    history,
    weights: league.format === "round_robin" ? ROUND_ROBIN_WEIGHTS : FLEX_WEIGHTS,
    roundNumber: round.roundNumber,
    blocked,
  });

  const season = await getAutoSeason(league.id);
  // A club's weekly match day and time, when the admin set one (PR 4).
  // Otherwise players pick a time for their match within the week.
  const scheduledAt = roundMatchTime(league, round);
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
        ...(scheduledAt ? { scheduledAt } : {}),
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
  if (players.length < minPlayers(league)) return null;
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
    .set({ publishedAt: new Date(), status: round.startDate <= todayFor(league) ? "active" : "upcoming" })
    .where(and(eq(leagueRoundsTable.id, round.id), isNull(leagueRoundsTable.publishedAt)))
    .returning();
  if (!published) return; // Someone else published it first.
  leagueChat.roundPublished(league.id, round.roundNumber);
  // D6: each doubles match gets one chat for all four.
  if (isDoubles(league)) await openChatsForRound(round.id, round.roundNumber).catch((err) => logger.error({ err, roundId: round.id }, "Doubles chats failed"));

  const [matches, byes, players] = await Promise.all([
    db.select().from(matchesTable).where(and(eq(matchesTable.roundId, round.id), isNull(matchesTable.voidedAt))),
    db.select().from(leagueRoundByesTable).where(eq(leagueRoundByesTable.roundId, round.id)),
    activePlayers(league.id),
  ]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const title = `Round ${round.roundNumber} pairings are out`;
  const sends: Promise<void>[] = [];
  const nameOf = (id: number) => byId.get(id)?.name ?? "Player";
  for (const m of matches) {
    if (m.player3Id != null && m.player4Id != null) {
      // Doubles (D8): "You and Sam vs. Jo and Lee. Play by Nov 15."
      const seats = [
        [m.player1Id, m.player3Id, m.player2Id, m.player4Id],
        [m.player3Id, m.player1Id, m.player2Id, m.player4Id],
        [m.player2Id, m.player4Id, m.player1Id, m.player3Id],
        [m.player4Id, m.player2Id, m.player1Id, m.player3Id],
      ] as const;
      for (const [me, partner, them1, them2] of seats) {
        const clerk = byId.get(me)?.clerkUserId;
        if (!clerk) continue;
        sends.push(
          sendPushToUsers(
            [clerk],
            title,
            `You and ${firstName(nameOf(partner))} vs. ${firstName(nameOf(them1))} and ${firstName(nameOf(them2))}. Play by ${shortDate(round.endDate)}.`,
            `/league/${league.id}`,
          ).catch(() => {}),
        );
      }
      continue;
    }
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
/** Published rounds' statuses follow the calendar. */
export async function syncRoundStatuses(rounds: LeagueRound[], today: string): Promise<void> {
  for (const r of rounds) {
    if (!r.publishedAt) continue;
    const status = today > r.endDate ? "completed" : today >= r.startDate ? "active" : "upcoming";
    if (status !== r.status) await db.update(leagueRoundsTable).set({ status }).where(eq(leagueRoundsTable.id, r.id));
  }
}

/**
 * League status: upcoming until the start, active through the last grace week
 * and any playoffs, then completed. Returns true once the season is over.
 */
export async function syncLeagueStatus(league: League, today: string): Promise<boolean> {
  // An admin ended it (decision 31): it stays completed.
  if (league.endedAt) return true;
  const start = league.startDate!;
  const lastRound = roundWindow(start, league.seasonWeeks!);
  if (today < start) {
    if (league.status !== "upcoming") await db.update(leaguesTable).set({ status: "upcoming" }).where(eq(leaguesTable.id, league.id));
    return false;
  }
  if (today <= lastRound.graceEnd) {
    if (league.status !== "active") await db.update(leaguesTable).set({ status: "active" }).where(eq(leaguesTable.id, league.id));
    return false;
  }
  const [playoffs] = await db
    .select({ id: playoffBracketsTable.id })
    .from(playoffBracketsTable)
    .where(and(eq(playoffBracketsTable.leagueId, league.id), eq(playoffBracketsTable.status, "active")));
  if (!playoffs && league.status !== "completed") {
    await db.update(leaguesTable).set({ status: "completed" }).where(eq(leaguesTable.id, league.id));
    // The season is over: its chat goes read only (decision 145).
    leagueChat.leagueChanged(league.id);
  }
  return true;
}

/**
 * Drafts the next round that hasn't gone out and whose deadline hasn't
 * passed, for an admin to review. Returns an existing draft if there is one.
 */
export async function draftNextRound(
  league: League,
  today: string = todayFor(league),
): Promise<{ round: LeagueRound } | { error: string }> {
  if (!usesWeeklyRounds(league)) return { error: "This league's rounds can't be drafted here." };
  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, league.id));
  for (let n = 1; n <= league.seasonWeeks!; n++) {
    const existing = rounds.find((r) => r.roundNumber === n);
    if (existing?.publishedAt) continue;
    if (roundWindow(league.startDate!, n).deadline < today) continue;
    const result = await ensureDraft(league, n);
    if (!result) return { error: isDoubles(league) ? "A doubles league needs at least 4 players to pair." : "A league needs at least 2 players to pair." };
    return { round: result.round };
  }
  return { error: "Every round this season has gone out." };
}

/**
 * The weekly loop for one league, run each morning: drafts tomorrow's round
 * for admin review, sends out any round that starts today or earlier, and
 * keeps round and league statuses in step with the calendar.
 */
export async function runLeagueDay(league: League, today: string = todayFor(league)): Promise<void> {
  if (!usesWeeklyRounds(league) || league.endedAt) return;
  const weeks = league.seasonWeeks!;
  const start = league.startDate!;
  const lastRound = roundWindow(start, weeks);

  const rounds = await db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, league.id));
  await syncRoundStatuses(rounds, today);

  // Playoffs start the day after the regular season's last deadline. Grace-week
  // scores don't count for standings, so the seeds are final by then.
  if (league.playoffSize && today > lastRound.deadline) {
    await startPlayoffs(league);
  }

  if (await syncLeagueStatus(league, today)) return;

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

/** The league day starts at 7am on the league's own clock: pairings go out then. */
export const LEAGUE_DAY_HOUR = 7;

/**
 * Runs the weekly loop for every league that uses it, once each league's own
 * clock has reached 7am (PR 4: leagues run on their creator's time zone). The
 * scheduler calls this every hour; the loop is safe to run more than once a
 * day, since drafts, sends and playoffs each happen only once.
 */
export async function runAllLeagueDays(now: Date = new Date()): Promise<void> {
  const leagues = await db.select().from(leaguesTable).where(isNotNull(leaguesTable.seasonWeeks));
  for (const league of leagues) {
    if (localHour(now, leagueZone(league)) < LEAGUE_DAY_HOUR) continue;
    try {
      await runLeagueDay(league, todayFor(league, now));
    } catch (err) {
      logger.error({ err, leagueId: league.id }, "League day failed");
    }
  }
}


/**
 * After an admin changes the weekly match day and time, rounds that haven't
 * gone out yet pick it up. Rounds already out keep the times they have, so a
 * time players agreed on isn't moved under them.
 */
export async function applyMatchTimeToDrafts(league: League): Promise<void> {
  const drafts = await db
    .select()
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.leagueId, league.id), isNull(leagueRoundsTable.publishedAt)));
  for (const round of drafts) {
    await db
      .update(matchesTable)
      .set({ scheduledAt: roundMatchTime(league, round) })
      .where(and(eq(matchesTable.roundId, round.id), isNull(matchesTable.voidedAt)));
  }
}
