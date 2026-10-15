import { db, matchesTable, playersTable, leaguesTable, playoffBracketsTable, leagueRoundsTable } from "@workspace/db";
import type { PlayoffSeeding } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendPushToUsers } from "../routes/notifications";

export const MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS = 6;

export const QF_PAIRINGS: readonly [number, number][] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

const QF_TO_SF: Record<number, { sfSlot: number; position: 1 | 2 }> = {
  1: { sfSlot: 1, position: 1 },
  2: { sfSlot: 1, position: 2 },
  3: { sfSlot: 2, position: 1 },
  4: { sfSlot: 2, position: 2 },
};

const SF_SLOT_PLAYERS: Record<number, { qfSlot1: number; qfSlot2: number }> = {
  1: { qfSlot1: 1, qfSlot2: 2 },
  2: { qfSlot1: 3, qfSlot2: 4 },
};

export interface PlayoffPlayerInfo {
  playerId: number;
  playerName: string;
  seed?: number;
}

function getPlayerForQFSlot(
  qfSlot: number,
  seedings: PlayoffSeeding[],
  bracketMatches: typeof matchesTable.$inferSelect[]
): PlayoffPlayerInfo | null {
  const [topSeed, bottomSeed] = QF_PAIRINGS[qfSlot - 1];
  const topPlayer = seedings.find((s) => s.seed === topSeed) ?? null;
  const bottomPlayer = seedings.find((s) => s.seed === bottomSeed) ?? null;

  if (topPlayer && !bottomPlayer) {
    return { playerId: topPlayer.playerId, playerName: topPlayer.playerName, seed: topPlayer.seed };
  }
  if (!topPlayer && bottomPlayer) {
    return { playerId: bottomPlayer.playerId, playerName: bottomPlayer.playerName, seed: bottomPlayer.seed };
  }
  if (!topPlayer && !bottomPlayer) return null;

  const qfMatch = bracketMatches.find(
    (m) => m.playoffRound === "quarterfinal" && m.playoffSlot === qfSlot
  );
  if (!qfMatch?.winnerId) return null;
  if (qfMatch.winnerId === topPlayer!.playerId) {
    return { playerId: topPlayer!.playerId, playerName: topPlayer!.playerName, seed: topPlayer!.seed };
  }
  return { playerId: bottomPlayer!.playerId, playerName: bottomPlayer!.playerName, seed: bottomPlayer!.seed };
}

function getPlayerForSFSlot(
  sfSlot: number,
  position: 1 | 2,
  seedings: PlayoffSeeding[],
  bracketMatches: typeof matchesTable.$inferSelect[]
): PlayoffPlayerInfo | null {
  const { qfSlot1, qfSlot2 } = SF_SLOT_PLAYERS[sfSlot];
  const qfSlot = position === 1 ? qfSlot1 : qfSlot2;
  return getPlayerForQFSlot(qfSlot, seedings, bracketMatches);
}

function getPlayerForFinal(
  position: 1 | 2,
  seedings: PlayoffSeeding[],
  bracketMatches: typeof matchesTable.$inferSelect[]
): PlayoffPlayerInfo | null {
  const sfSlot = position;
  const sfMatch = bracketMatches.find(
    (m) => m.playoffRound === "semifinal" && m.playoffSlot === sfSlot
  );
  if (sfMatch?.winnerId) {
    const allPlayers = seedings;
    const p = allPlayers.find((s) => s.playerId === sfMatch.winnerId);
    return p
      ? { playerId: p.playerId, playerName: p.playerName, seed: p.seed }
      : { playerId: sfMatch.winnerId, playerName: "Unknown" };
  }
  return getPlayerForSFSlot(sfSlot, 1, seedings, bracketMatches) === null &&
    getPlayerForSFSlot(sfSlot, 2, seedings, bracketMatches) === null
    ? null
    : null;
}

export interface BracketQFSlot {
  slot: number;
  topSeed: number;
  topPlayerId: number | null;
  topPlayerName: string | null;
  bottomSeed: number;
  bottomPlayerId: number | null;
  bottomPlayerName: string | null;
  isBye: boolean;
  matchId: number | null;
  matchStatus: string | null;
  score: string | null;
  winnerId: number | null;
}

export interface BracketAdvancedSlot {
  slot: number;
  topPlayerId: number | null;
  topPlayerName: string | null;
  bottomPlayerId: number | null;
  bottomPlayerName: string | null;
  matchId: number | null;
  matchStatus: string | null;
  score: string | null;
  winnerId: number | null;
}

export interface PlayoffBracketResponse {
  bracketId: number;
  leagueId: number;
  status: string;
  generatedAt: string;
  seedings: PlayoffSeeding[];
  quarterfinals: BracketQFSlot[];
  semifinals: BracketAdvancedSlot[];
  final: BracketAdvancedSlot;
  champion: { playerId: number; playerName: string } | null;
}

export async function buildBracketResponse(bracketId: number): Promise<PlayoffBracketResponse> {
  const [bracket] = await db
    .select()
    .from(playoffBracketsTable)
    .where(eq(playoffBracketsTable.id, bracketId));
  if (!bracket) throw new Error("Bracket not found");

  const seedings = bracket.seedings as PlayoffSeeding[];
  const bracketMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.playoffBracketId, bracketId));

  const playerMap: Record<number, string> = {};
  for (const s of seedings) playerMap[s.playerId] = s.playerName;
  for (const m of bracketMatches) {
    playerMap[m.player1Id] = playerMap[m.player1Id] ?? "Unknown";
    playerMap[m.player2Id] = playerMap[m.player2Id] ?? "Unknown";
  }

  const quarterfinals: BracketQFSlot[] = QF_PAIRINGS.map(([topSeed, bottomSeed], idx) => {
    const slot = idx + 1;
    const topPlayer = seedings.find((s) => s.seed === topSeed) ?? null;
    const bottomPlayer = seedings.find((s) => s.seed === bottomSeed) ?? null;
    const isBye = (topPlayer !== null) !== (bottomPlayer !== null);
    const qfMatch = bracketMatches.find(
      (m) => m.playoffRound === "quarterfinal" && m.playoffSlot === slot
    ) ?? null;
    return {
      slot,
      topSeed,
      topPlayerId: topPlayer?.playerId ?? null,
      topPlayerName: topPlayer?.playerName ?? null,
      bottomSeed,
      bottomPlayerId: bottomPlayer?.playerId ?? null,
      bottomPlayerName: bottomPlayer?.playerName ?? null,
      isBye,
      matchId: qfMatch?.id ?? null,
      matchStatus: qfMatch?.status ?? null,
      score: qfMatch?.score ?? null,
      winnerId: qfMatch?.winnerId ?? null,
    };
  });

  const semifinals: BracketAdvancedSlot[] = [1, 2].map((sfSlot) => {
    const topPlayer = getPlayerForSFSlot(sfSlot, 1, seedings, bracketMatches);
    const bottomPlayer = getPlayerForSFSlot(sfSlot, 2, seedings, bracketMatches);
    const sfMatch = bracketMatches.find(
      (m) => m.playoffRound === "semifinal" && m.playoffSlot === sfSlot
    ) ?? null;
    return {
      slot: sfSlot,
      topPlayerId: topPlayer?.playerId ?? null,
      topPlayerName: topPlayer?.playerName ?? null,
      bottomPlayerId: bottomPlayer?.playerId ?? null,
      bottomPlayerName: bottomPlayer?.playerName ?? null,
      matchId: sfMatch?.id ?? null,
      matchStatus: sfMatch?.status ?? null,
      score: sfMatch?.score ?? null,
      winnerId: sfMatch?.winnerId ?? null,
    };
  });

  const finalTopPlayer = (() => {
    const sfMatch1 = bracketMatches.find((m) => m.playoffRound === "semifinal" && m.playoffSlot === 1);
    if (sfMatch1?.winnerId) {
      const s = seedings.find((x) => x.playerId === sfMatch1.winnerId);
      return s
        ? { playerId: s.playerId, playerName: s.playerName }
        : { playerId: sfMatch1.winnerId, playerName: playerMap[sfMatch1.winnerId] ?? "Unknown" };
    }
    const p = getPlayerForSFSlot(1, 1, seedings, bracketMatches);
    const q = getPlayerForSFSlot(1, 2, seedings, bracketMatches);
    if (p && q) {
      const directSFMatch = bracketMatches.find((m) => m.playoffRound === "semifinal" && m.playoffSlot === 1);
      if (!directSFMatch) return null;
    }
    return null;
  })();

  const finalBottomPlayer = (() => {
    const sfMatch2 = bracketMatches.find((m) => m.playoffRound === "semifinal" && m.playoffSlot === 2);
    if (sfMatch2?.winnerId) {
      const s = seedings.find((x) => x.playerId === sfMatch2.winnerId);
      return s
        ? { playerId: s.playerId, playerName: s.playerName }
        : { playerId: sfMatch2.winnerId, playerName: playerMap[sfMatch2.winnerId] ?? "Unknown" };
    }
    return null;
  })();

  const finalMatch = bracketMatches.find((m) => m.playoffRound === "final") ?? null;

  const final: BracketAdvancedSlot = {
    slot: 1,
    topPlayerId: finalMatch ? finalMatch.player1Id : (finalTopPlayer?.playerId ?? null),
    topPlayerName: finalMatch
      ? (playerMap[finalMatch.player1Id] ?? "Unknown")
      : (finalTopPlayer?.playerName ?? null),
    bottomPlayerId: finalMatch ? finalMatch.player2Id : (finalBottomPlayer?.playerId ?? null),
    bottomPlayerName: finalMatch
      ? (playerMap[finalMatch.player2Id] ?? "Unknown")
      : (finalBottomPlayer?.playerName ?? null),
    matchId: finalMatch?.id ?? null,
    matchStatus: finalMatch?.status ?? null,
    score: finalMatch?.score ?? null,
    winnerId: finalMatch?.winnerId ?? null,
  };

  let champion: { playerId: number; playerName: string } | null = null;
  if (finalMatch?.winnerId) {
    const s = seedings.find((x) => x.playerId === finalMatch.winnerId);
    champion = {
      playerId: finalMatch.winnerId,
      playerName: s?.playerName ?? (playerMap[finalMatch.winnerId] ?? "Unknown"),
    };
  }

  return {
    bracketId: bracket.id,
    leagueId: bracket.leagueId,
    status: bracket.status,
    generatedAt: bracket.generatedAt.toISOString(),
    seedings,
    quarterfinals,
    semifinals,
    final,
    champion,
  };
}

export async function generatePlayoffBracket(leagueId: number): Promise<PlayoffBracketResponse> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) throw new Error("League not found");

  const existing = await db
    .select()
    .from(playoffBracketsTable)
    .where(and(eq(playoffBracketsTable.leagueId, leagueId), eq(playoffBracketsTable.status, "active")));
  if (existing.length > 0) throw new Error("A playoff bracket is already active for this league");

  const [{ completedRoundCount }] = await db
    .select({ completedRoundCount: count() })
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.leagueId, leagueId), eq(leagueRoundsTable.status, "completed")));
  if (completedRoundCount < MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS) {
    throw new Error(
      `Need at least ${MIN_COMPLETED_ROUNDS_FOR_PLAYOFFS} completed rounds to generate playoffs (${completedRoundCount} completed so far)`
    );
  }

  if (league.leagueType !== "singles") {
    throw new Error("Playoffs are only available for singles leagues.");
  }

  const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId));
  if (players.length < 4) throw new Error("Need at least 4 players to generate a playoff bracket");

  const sortedPlayers = [...players].sort((a, b) => {
    const aTotal = a.wins + a.losses;
    const bTotal = b.wins + b.losses;
    const aRate = aTotal > 0 ? a.wins / aTotal : 0;
    const bRate = bTotal > 0 ? b.wins / bTotal : 0;
    if (bRate !== aRate) return bRate - aRate;
    return b.wins - a.wins;
  });

  const top8 = sortedPlayers.slice(0, 8);
  const seedings: PlayoffSeeding[] = top8.map((p, idx) => {
    const total = p.wins + p.losses;
    return {
      seed: idx + 1,
      playerId: p.id,
      playerName: p.name,
      winRate: total > 0 ? p.wins / total : 0,
    };
  });

  const [bracket] = await db
    .insert(playoffBracketsTable)
    .values({ leagueId, status: "active", seedings })
    .returning();

  const bracketMatches = await db.select().from(matchesTable).where(eq(matchesTable.playoffBracketId, bracket.id));

  for (let qfSlot = 1; qfSlot <= 4; qfSlot++) {
    const [topSeed, bottomSeed] = QF_PAIRINGS[qfSlot - 1];
    const topPlayer = seedings.find((s) => s.seed === topSeed) ?? null;
    const bottomPlayer = seedings.find((s) => s.seed === bottomSeed) ?? null;

    if (topPlayer && bottomPlayer) {
      await db.insert(matchesTable).values({
        leagueId,
        player1Id: topPlayer.playerId,
        player2Id: bottomPlayer.playerId,
        status: "scheduled",
        generatedFrom: "playoff",
        playoffBracketId: bracket.id,
        playoffRound: "quarterfinal",
        playoffSlot: qfSlot,
      });
    }
  }

  const freshBracketMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.playoffBracketId, bracket.id));

  for (let sfSlot = 1; sfSlot <= 2; sfSlot++) {
    const topPlayer = getPlayerForSFSlot(sfSlot, 1, seedings, freshBracketMatches);
    const bottomPlayer = getPlayerForSFSlot(sfSlot, 2, seedings, freshBracketMatches);
    if (topPlayer && bottomPlayer) {
      await db.insert(matchesTable).values({
        leagueId,
        player1Id: topPlayer.playerId,
        player2Id: bottomPlayer.playerId,
        status: "scheduled",
        generatedFrom: "playoff",
        playoffBracketId: bracket.id,
        playoffRound: "semifinal",
        playoffSlot: sfSlot,
      });
    }
  }

  const clerkIds = top8.map((p) => p.clerkUserId).filter(Boolean) as string[];
  sendPushToUsers(
    clerkIds,
    "Playoffs are set",
    `The playoff bracket for ${league.name} has been generated. Check your matchup now.`,
    `/leagues/${leagueId}`
  ).catch(() => {});

  logger.info({ leagueId, bracketId: bracket.id, playerCount: top8.length }, "Playoff bracket generated");

  return buildBracketResponse(bracket.id);
}

export async function advancePlayoffWinner(
  completedMatch: typeof matchesTable.$inferSelect,
  winnerId: number
): Promise<void> {
  const { playoffBracketId, playoffRound, playoffSlot } = completedMatch;
  if (!playoffBracketId || !playoffRound || !playoffSlot) return;

  const [bracket] = await db
    .select()
    .from(playoffBracketsTable)
    .where(eq(playoffBracketsTable.id, playoffBracketId));
  if (!bracket) return;

  const seedings = bracket.seedings as PlayoffSeeding[];
  const bracketMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.playoffBracketId, playoffBracketId));

  const winnerSeed = seedings.find((s) => s.playerId === winnerId);
  const winnerName = winnerSeed?.playerName ?? "A player";

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, bracket.leagueId));

  if (playoffRound === "quarterfinal") {
    const { sfSlot, position } = QF_TO_SF[playoffSlot];
    const otherPosition: 1 | 2 = position === 1 ? 2 : 1;
    const otherPlayer = getPlayerForSFSlot(sfSlot, otherPosition, seedings, bracketMatches);

    if (otherPlayer) {
      const existingSF = bracketMatches.find(
        (m) => m.playoffRound === "semifinal" && m.playoffSlot === sfSlot
      );
      if (!existingSF) {
        const p1 = position === 1
          ? { playerId: winnerId }
          : { playerId: otherPlayer.playerId };
        const p2 = position === 2
          ? { playerId: winnerId }
          : { playerId: otherPlayer.playerId };
        await db.insert(matchesTable).values({
          leagueId: bracket.leagueId,
          player1Id: p1.playerId,
          player2Id: p2.playerId,
          status: "scheduled",
          generatedFrom: "playoff",
          playoffBracketId,
          playoffRound: "semifinal",
          playoffSlot: sfSlot,
        });
        logger.info({ bracketId: playoffBracketId, sfSlot }, "Playoff SF match created");

        const sfPlayers = await db.select().from(playersTable).where(
          eq(playersTable.id, p1.playerId)
        );
        const sfPlayer2 = await db.select().from(playersTable).where(
          eq(playersTable.id, p2.playerId)
        );
        const sfClerkIds = [...sfPlayers, ...sfPlayer2].map((p) => p.clerkUserId).filter(Boolean) as string[];
        sendPushToUsers(
          sfClerkIds,
          "Semifinal set",
          `Your semifinal match has been scheduled for ${league?.name ?? "the league"}. Good luck!`,
          `/leagues/${bracket.leagueId}`
        ).catch(() => {});
      }
    }
  } else if (playoffRound === "semifinal") {
    const position: 1 | 2 = playoffSlot === 1 ? 1 : 2;
    const otherSFSlot = playoffSlot === 1 ? 2 : 1;
    const otherSFMatch = bracketMatches.find(
      (m) => m.playoffRound === "semifinal" && m.playoffSlot === otherSFSlot
    );
    const otherPlayerId = otherSFMatch?.winnerId ?? null;

    if (otherPlayerId) {
      const existingFinal = bracketMatches.find((m) => m.playoffRound === "final");
      if (!existingFinal) {
        const p1Id = position === 1 ? winnerId : otherPlayerId;
        const p2Id = position === 2 ? winnerId : otherPlayerId;
        await db.insert(matchesTable).values({
          leagueId: bracket.leagueId,
          player1Id: p1Id,
          player2Id: p2Id,
          status: "scheduled",
          generatedFrom: "playoff",
          playoffBracketId,
          playoffRound: "final",
          playoffSlot: 1,
        });
        logger.info({ bracketId: playoffBracketId }, "Playoff Final match created");

        const fp1 = await db.select().from(playersTable).where(eq(playersTable.id, p1Id));
        const fp2 = await db.select().from(playersTable).where(eq(playersTable.id, p2Id));
        const finalClerkIds = [...fp1, ...fp2].map((p) => p.clerkUserId).filter(Boolean) as string[];
        sendPushToUsers(
          finalClerkIds,
          "The Final is set",
          `You've reached the final of ${league?.name ?? "the league"}! Time to play for the championship.`,
          `/leagues/${bracket.leagueId}`
        ).catch(() => {});
      }
    }
  } else if (playoffRound === "final") {
    await db
      .update(playoffBracketsTable)
      .set({ status: "completed" })
      .where(eq(playoffBracketsTable.id, playoffBracketId));
    await db
      .update(leaguesTable)
      .set({ status: "completed" })
      .where(eq(leaguesTable.id, bracket.leagueId));

    logger.info({ bracketId: playoffBracketId, winnerId, leagueId: bracket.leagueId }, "Playoff complete — champion crowned");

    const leaguePlayers = await db.select().from(playersTable).where(eq(playersTable.leagueId, bracket.leagueId));
    const allClerkIds = leaguePlayers.map((p) => p.clerkUserId).filter(Boolean) as string[];
    sendPushToUsers(
      allClerkIds,
      "Champion crowned",
      `${winnerName} wins the ${league?.name ?? "league"} championship!`,
      `/leagues/${bracket.leagueId}`
    ).catch(() => {});
  }
}
