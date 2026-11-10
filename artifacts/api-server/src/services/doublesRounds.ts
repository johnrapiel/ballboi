// Weekly rounds for doubles leagues (doubles flow review, John, Nov 9: D2,
// D4, D5). The weekly loop in leagueRounds.ts calls this in place of singles
// pairing. The pairing rules live in lib/doublesPairing.ts; this file loads
// what they need and saves the result. Reused from draft PR #115.
//
// - Rotating partners (D5): fours by close level, the most even split, no
//   repeat partner while anyone new is possible, leftovers get byes.
// - Fixed partners (D2): anyone without a partner when the first round goes
//   out is teamed with the closest level and keeps that partner. After that,
//   a player without a partner (theirs left, D4) has byes until an admin
//   re-teams them.

import {
  db,
  leagueRoundByesTable,
  leagueRoundsTable,
  leagueTeamsTable,
  leaguesTable,
  matchesTable,
  playerAvailabilityTable,
  playersTable,
  type League,
  type LeagueRound,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { roundMatchTime } from "../lib/leagueCalendar.js";
import { FLEX_WEIGHTS, ROUND_ROBIN_WEIGHTS, slotKeys, type PairingPlayer } from "../lib/pairing.js";
import {
  autoTeams,
  doublesHistory,
  pairFixedDoubles,
  pairRotatingDoubles,
  teamMeetings,
  type DoublesMatchup,
  type DoublesTeam,
} from "../lib/doublesPairing.js";
import { partnerModeOf } from "../lib/doublesTeams.js";
import { blockedPlayerPairs } from "../lib/blocks.js";
import { loadProfiles, playerLevelValue } from "../lib/playerProfile.js";
import { sendPushToUsers } from "../routes/notifications.js";
import { getAutoSeason } from "./seasonService.js";

/** The league's active fixed teams: both partners still playing. */
export async function activeTeams(leagueId: number): Promise<DoublesTeam[]> {
  const [teams, players] = await Promise.all([
    db
      .select()
      .from(leagueTeamsTable)
      .where(and(eq(leagueTeamsTable.leagueId, leagueId), isNull(leagueTeamsTable.dissolvedAt))),
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

async function firstRoundOut(leagueId: number): Promise<boolean> {
  const rows = await db
    .select({ id: leagueRoundsTable.id })
    .from(leagueRoundsTable)
    .where(and(eq(leagueRoundsTable.leagueId, leagueId), isNotNull(leagueRoundsTable.publishedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * D2: teams up players with no partner, closest level first, and tells them.
 * Returns the ones still without one (an odd one out, or a block).
 */
async function teamUpUnpartnered(league: League, players: PairingPlayer[], blocked: Set<string>): Promise<number[]> {
  const { teams, left } = autoTeams(players, blocked);
  if (!teams.length) return left;
  await db.insert(leagueTeamsTable).values(teams.map(([a, b]) => ({ leagueId: league.id, player1Id: a, player2Id: b, madeBy: "auto" })));
  await db.update(playersTable).set({ lookingForPartnerAt: null }).where(inArray(playersTable.id, teams.flat()));
  const rows = await db.select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, teams.flat()));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [a, b] of teams) {
    for (const [me, them] of [[a, b], [b, a]]) {
      const clerk = byId.get(me)?.clerkUserId;
      if (clerk) {
        sendPushToUsers([clerk], "You're teamed up", `You and ${byId.get(them)?.name ?? "your partner"} are partners for ${league.name}.`, `/league/${league.id}`).catch(() => {});
      }
    }
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

  let result: { matches: (DoublesMatchup & { teamIds?: [number, number] })[]; byes: number[] };
  if (partnerModeOf(league) === "rotating") {
    const blocked = await blockedPlayerPairs(playerIds);
    result = pairRotatingDoubles({ players: pairingPlayers, history: doublesHistory(matches), weights, roundNumber: round.roundNumber, blocked });
  } else {
    const blocked = await blockedPlayerPairs(everyone.map((p) => p.id));
    let teams = await activeTeams(league.id);
    const onTeam = new Set(teams.flatMap((t) => t.playerIds));
    const solo = pairingPlayers.filter((p) => !onTeam.has(p.id));
    // D2: only when the first round goes out. After that (D4), byes until an admin re-teams them.
    let waiting = solo.map((p) => p.id);
    if (solo.length && !(await firstRoundOut(league.id))) {
      waiting = await teamUpUnpartnered(league, solo, blocked);
      if (waiting.length < solo.length) teams = await activeTeams(league.id);
    }
    // A team plays only when both partners are open this round.
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
    const teamIdOf = (pair: [number, number]) => teams.find((t) => t.playerIds.every((id) => pair.includes(id)))?.id;
    result = {
      matches: fixed.matches.map((m) => ({ ...m, teamIds: [teamIdOf(m.team1)!, teamIdOf(m.team2)!] as [number, number] })),
      byes: [...fixed.byes, ...halfOpen, ...waiting],
    };
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
        team1Id: m.teamIds?.[0] ?? null,
        team2Id: m.teamIds?.[1] ?? null,
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

/** Fixed-partner standings need the teams with names (D3). */
export async function standingTeams(leagueId: number) {
  const teams = await db
    .select()
    .from(leagueTeamsTable)
    .where(and(eq(leagueTeamsTable.leagueId, leagueId), isNull(leagueTeamsTable.dissolvedAt)));
  return teams.map((t) => ({ id: t.id, playerIds: [t.player1Id, t.player2Id] as [number, number] }));
}

export async function leagueOf(leagueId: number) {
  const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  return l ?? null;
}
