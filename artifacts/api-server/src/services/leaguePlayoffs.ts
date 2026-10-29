// Playoffs for leagues on the weekly loop (spec: Leagues > Setup: "optional
// playoff for top 4 or 8"). The bracket is set the day after the regular
// season's last deadline, from the standings; winners move on as soon as a
// score is entered. Rules live in lib/playoffs.ts.

import { db, leaguesTable, matchesTable, playersTable, playoffBracketsTable, type League, type PlayoffSeeding } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { computeStandings } from "../lib/leagueStandings.js";
import {
  advanceTo,
  bracketSize,
  bracketView,
  firstRoundSeeds,
  nextRound,
  partnerSlot,
  roundNameFor,
  seedOrder,
  type BracketSeed,
  type PlayoffRound,
} from "../lib/playoffs.js";
import { logger } from "../lib/logger.js";
import { sendPushToUsers } from "../routes/notifications.js";

const ROUND_WORDS: Record<PlayoffRound, string> = { quarterfinal: "quarterfinal", semifinal: "semifinal", final: "final" };

async function notifyPlayers(playerIds: number[], title: string, body: string, leagueId: number) {
  if (!playerIds.length) return;
  const rows = await db.select({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, playerIds));
  const ids = rows.map((r) => r.clerkUserId).filter((id): id is string => !!id);
  if (ids.length) await sendPushToUsers(ids, title, body, `/league/${leagueId}`).catch(() => {});
}

/** The league's bracket, if playoffs have started. */
export async function currentBracket(leagueId: number) {
  const brackets = await db.select().from(playoffBracketsTable).where(eq(playoffBracketsTable.leagueId, leagueId));
  return brackets.sort((a, b) => b.id - a.id)[0] ?? null;
}

/** Seeds the bracket from the standings and creates the first round. Does nothing if it exists. */
export async function startPlayoffs(league: League): Promise<void> {
  if (!league.playoffSize) return;
  if (await currentBracket(league.id)) return;

  const [players, matches] = await Promise.all([
    db.select().from(playersTable).where(eq(playersTable.leagueId, league.id)),
    db.select().from(matchesTable).where(eq(matchesTable.leagueId, league.id)),
  ]);
  const size = bracketSize(league.playoffSize, players.filter((p) => !p.leftAt).length);
  if (!size) {
    logger.info({ leagueId: league.id }, "Too few players for playoffs");
    return;
  }
  const seeded = seedOrder(computeStandings(players, matches), matches).slice(0, size);
  const seedings: PlayoffSeeding[] = seeded.map((s, i) => ({
    seed: i + 1,
    playerId: s.playerId,
    playerName: s.playerName,
    winRate: s.winRate,
  }));

  const [bracket] = await db.insert(playoffBracketsTable).values({ leagueId: league.id, status: "active", seedings }).returning();
  const round = roundNameFor(size / 2);
  const bySeed = (n: number) => seedings.find((s) => s.seed === n)!;
  await db.insert(matchesTable).values(
    firstRoundSeeds(size).map(([a, b], i) => ({
      leagueId: league.id,
      player1Id: bySeed(a).playerId,
      player2Id: bySeed(b).playerId,
      status: "scheduled",
      generatedFrom: "playoff",
      playoffBracketId: bracket.id,
      playoffRound: round,
      playoffSlot: i + 1,
    })),
  );

  await notifyPlayers(
    seedings.map((s) => s.playerId),
    "You made the playoffs",
    `${league.name}: the top ${size} are set. Check your ${ROUND_WORDS[round]} opponent.`,
    league.id,
  );
  logger.info({ leagueId: league.id, bracketId: bracket.id, size }, "Playoffs started");
}

/** After a playoff score: puts the winner in the next match once its other half is decided, or crowns the champion. */
export async function advancePlayoff(match: typeof matchesTable.$inferSelect, winnerId: number): Promise<void> {
  const { playoffBracketId, playoffRound, playoffSlot, leagueId } = match;
  if (!playoffBracketId || !playoffRound || !playoffSlot || !leagueId) return;
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  const next = nextRound(playoffRound as PlayoffRound);

  if (!next) {
    await db.update(playoffBracketsTable).set({ status: "completed" }).where(eq(playoffBracketsTable.id, playoffBracketId));
    const [winner] = await db.select({ name: playersTable.name }).from(playersTable).where(eq(playersTable.id, winnerId));
    const everyone = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.leagueId, leagueId));
    await notifyPlayers(
      everyone.map((p) => p.id),
      "Champion",
      `${winner?.name ?? "A player"} won ${league?.name ?? "the league"}.`,
      leagueId,
    );
    return;
  }

  const [other] = await db
    .select()
    .from(matchesTable)
    .where(and(
      eq(matchesTable.playoffBracketId, playoffBracketId),
      eq(matchesTable.playoffRound, playoffRound),
      eq(matchesTable.playoffSlot, partnerSlot(playoffSlot)),
    ));
  if (!other?.winnerId) return; // Waiting on the other half of the draw.

  const to = advanceTo(playoffSlot);
  const [existing] = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(and(
      eq(matchesTable.playoffBracketId, playoffBracketId),
      eq(matchesTable.playoffRound, next),
      eq(matchesTable.playoffSlot, to.slot),
      isNull(matchesTable.voidedAt),
    ));
  if (existing) return;

  const [p1, p2] = to.position === 1 ? [winnerId, other.winnerId] : [other.winnerId, winnerId];
  await db.insert(matchesTable).values({
    leagueId,
    player1Id: p1,
    player2Id: p2,
    status: "scheduled",
    generatedFrom: "playoff",
    playoffBracketId,
    playoffRound: next,
    playoffSlot: to.slot,
  });
  await notifyPlayers([p1, p2], next === "final" ? "You're in the final" : "You're in the semifinal", `${league?.name ?? "Your league"}: check your next opponent.`, leagueId);
}

/** The bracket for the app: every slot, played or to come, and the champion. */
export async function bracketFor(league: League) {
  const bracket = await currentBracket(league.id);
  if (!bracket) return null;
  const seeds: BracketSeed[] = (bracket.seedings as PlayoffSeeding[]).map((s) => ({
    seed: s.seed,
    playerId: s.playerId,
    playerName: s.playerName,
  }));
  const size = seeds.length >= 8 ? 8 : 4;
  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.playoffBracketId, bracket.id), isNull(matchesTable.voidedAt)));
  return { bracketId: bracket.id, status: bracket.status, ...bracketView(size, seeds, matches) };
}
