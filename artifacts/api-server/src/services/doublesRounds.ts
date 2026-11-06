// Weekly rounds for doubles leagues (Wave 2, doubles pairing). The weekly loop
// in leagueRounds.ts calls this in place of singles pairing. The pairing rules
// live in lib/doublesPairing.ts; this file loads what they need and saves the
// result, and keeps fixed-partner teams.

import {
  db,
  leagueRoundByesTable,
  leagueRoundsTable,
  leagueTeamsTable,
  matchesTable,
  playerAvailabilityTable,
  playersTable,
  type League,
  type LeagueRound,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { roundMatchTime } from "../lib/leagueCalendar.js";
import { FLEX_WEIGHTS, ROUND_ROBIN_WEIGHTS, slotKeys, type PairingPlayer } from "../lib/pairing.js";
import {
  autoTeams,
  doublesHistory,
  pairFixedDoubles,
  pairRotatingDoubles,
  teamMeetings,
  type DoublesResult,
  type DoublesTeam,
} from "../lib/doublesPairing.js";
import { blockedPlayerPairs } from "../lib/blocks.js";
import { loadProfiles, playerLevelValue } from "../lib/playerProfile.js";
import { getAutoSeason } from "./seasonService.js";

/** A doubles league needs four players for a match. */
export const MIN_DOUBLES_PLAYERS = 4;

export function isDoubles(league: Pick<League, "leagueType">): boolean {
  return league.leagueType === "doubles";
}

/** Fixed partners, or rotating (also the reading for a doubles league made before partners were a setting). */
export function partnerModeOf(league: Pick<League, "partnerMode">): "fixed" | "rotating" {
  return league.partnerMode === "fixed" ? "fixed" : "rotating";
}

/**
 * The league's fixed teams where both partners are still playing. A team with
 * a partner who left no longer counts; its other player is without a partner.
 */
export async function activeTeams(leagueId: number): Promise<DoublesTeam[]> {
  const [teams, players] = await Promise.all([
    db.select().from(leagueTeamsTable).where(eq(leagueTeamsTable.leagueId, leagueId)),
    db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt))),
  ]);
  const active = new Set(players.map((p) => p.id));
  return teams
    .filter((t) => active.has(t.player1Id) && active.has(t.player2Id))
    .map((t) => ({ id: t.id, playerIds: [t.player1Id, t.player2Id] as [number, number] }));
}

/** Clears team rows that lost a partner, so their remaining player can be teamed again. */
async function dropBrokenTeams(leagueId: number, active: Set<number>): Promise<void> {
  const teams = await db.select().from(leagueTeamsTable).where(eq(leagueTeamsTable.leagueId, leagueId));
  const broken = teams.filter((t) => !active.has(t.player1Id) || !active.has(t.player2Id)).map((t) => t.id);
  if (broken.length) await db.delete(leagueTeamsTable).where(inArray(leagueTeamsTable.id, broken));
}

/**
 * Teams up active players who have no partner, closest level first, and
 * saves the new teams. Returns the ones who still have none (an odd one out
 * or a block).
 */
export async function teamUpUnpartnered(league: League, players: PairingPlayer[], blocked: Set<string>): Promise<number[]> {
  const { teams, left } = autoTeams(players, blocked);
  if (teams.length) {
    await db
      .insert(leagueTeamsTable)
      .values(teams.map(([a, b]) => ({ leagueId: league.id, player1Id: a, player2Id: b })))
      .onConflictDoNothing();
  }
  return left;
}

/** Pairs this round's open players for a doubles league and saves the matches and byes. */
export async function pairOpenDoubles(league: League, round: LeagueRound, playerIds: number[]): Promise<void> {
  if (playerIds.length === 0) return;
  const [players, availability, matches, byeRows, everyone] = await Promise.all([
    db.select().from(playersTable).where(inArray(playersTable.id, playerIds)),
    db
      .select()
      .from(playerAvailabilityTable)
      .where(and(eq(playerAvailabilityTable.leagueId, league.id), eq(playerAvailabilityTable.weekOf, round.startDate))),
    // Every match so far this season, this round's kept matches included.
    db
      .select({ player1Id: matchesTable.player1Id, player2Id: matchesTable.player2Id, player3Id: matchesTable.player3Id, player4Id: matchesTable.player4Id })
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, league.id), isNull(matchesTable.voidedAt), isNull(matchesTable.playoffBracketId))),
    db
      .select({ playerId: leagueRoundByesTable.playerId, roundId: leagueRoundByesTable.roundId })
      .from(leagueRoundByesTable)
      .innerJoin(leagueRoundsTable, eq(leagueRoundsTable.id, leagueRoundByesTable.roundId))
      .where(eq(leagueRoundsTable.leagueId, league.id)),
    db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, league.id), isNull(playersTable.leftAt))),
  ]);
  const byeCounts = new Map<number, number>();
  for (const b of byeRows) if (b.roundId !== round.id) byeCounts.set(b.playerId, (byeCounts.get(b.playerId) ?? 0) + 1);

  // Pairs on each player's current profile level, like singles Flex.
  const profiles = await loadProfiles(players.map((p) => p.clerkUserId));
  const pairingPlayers: PairingPlayer[] = players.map((p) => ({
    id: p.id,
    rating: playerLevelValue(p, profiles),
    slots: slotKeys(availability.find((a) => a.playerId === p.id)?.slots),
    byes: byeCounts.get(p.id) ?? 0,
  }));
  const weights = league.format === "round_robin" ? ROUND_ROBIN_WEIGHTS : FLEX_WEIGHTS;
  const open = new Set(playerIds);

  let result: DoublesResult;
  if (partnerModeOf(league) === "rotating") {
    const blocked = await blockedPlayerPairs(playerIds);
    result = pairRotatingDoubles({ players: pairingPlayers, history: doublesHistory(matches), weights, roundNumber: round.roundNumber, blocked });
  } else {
    await dropBrokenTeams(league.id, new Set(everyone.map((p) => p.id)));
    let teams = await activeTeams(league.id);
    const onTeam = new Set(teams.flatMap((t) => t.playerIds));
    const blocked = await blockedPlayerPairs(everyone.map((p) => p.id));
    // Anyone open without a partner gets one now, and keeps them for the season.
    const solo = pairingPlayers.filter((p) => !onTeam.has(p.id));
    const waiting = await teamUpUnpartnered(league, solo, blocked);
    if (solo.length > waiting.length) teams = await activeTeams(league.id);
    // A team plays only when both partners are open this round. The other
    // partner sits out when one is locked into a match or has an admin bye.
    const playing = teams.filter((t) => t.playerIds.every((id) => open.has(id)));
    const halfOpen = teams.filter((t) => !playing.includes(t)).flatMap((t) => t.playerIds.filter((id) => open.has(id)));
    const fixed = pairFixedDoubles({
      teams: playing,
      players: pairingPlayers,
      teamHistory: teamMeetings(teams, matches),
      weights,
      roundNumber: round.roundNumber,
      blocked,
    });
    result = { matches: fixed.matches, byes: [...fixed.byes, ...halfOpen, ...waiting] };
  }

  const season = await getAutoSeason(league.id);
  const scheduledAt = roundMatchTime(league, round);
  if (result.matches.length) {
    await db.insert(matchesTable).values(
      result.matches.map((m) => ({
        leagueId: league.id,
        player1Id: m.team1[0],
        player3Id: m.team1[1],
        player2Id: m.team2[0],
        player4Id: m.team2[1],
        status: "scheduled",
        generatedFrom: "round",
        weekOf: round.startDate,
        roundId: round.id,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(season ? { season } : {}),
      })),
    );
  }
  const byes = [...new Set(result.byes)];
  if (byes.length) {
    await db.insert(leagueRoundByesTable).values(byes.map((playerId) => ({ roundId: round.id, playerId }))).onConflictDoNothing();
  }
}

/** "Alex Kim and Sam Lee" */
export function teamName(ids: (number | null | undefined)[], name: (id: number) => string): string {
  return ids
    .filter((id): id is number => id != null)
    .map(name)
    .join(" and ");
}
