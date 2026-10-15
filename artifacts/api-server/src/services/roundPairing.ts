import { db, matchesTable, playersTable, leagueRoundsTable } from "@workspace/db";
import { eq, and, max, asc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getAutoSeason } from "./seasonService.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export interface RoundMatchup {
  player1Id: number;
  player1Name: string;
  player2Id: number;
  player2Name: string;
}

export interface GeneratedRound {
  roundId: number;
  roundNumber: number;
  startDate: string;
  endDate: string;
  status: string;
  leagueId: number;
  matchups: Array<RoundMatchup & { matchId: number; status: string; score: string | null; winnerId: number | null; scheduledAt: string | null }>;
}

/**
 * Circle method (Berger tables) round-robin pairing.
 * Guarantees no two players face each other more than once in the first n-1 rounds.
 *
 * @param players   Full player list for the league (sorted consistently).
 * @param roundIndex 0-based round index (0 = first round, 1 = second, …).
 */
export function circleMethodPairs(
  players: (typeof playersTable.$inferSelect)[],
  roundIndex: number
): { p1: typeof players[0]; p2: typeof players[0] }[] {
  const n = players.length;
  if (n < 2) return [];

  // For odd n, append a null "bye" slot so the length is even
  const slots: (typeof players[0] | null)[] =
    n % 2 === 0 ? [...players] : [...players, null];

  const m = slots.length; // always even
  const fixed = slots[0];

  // Rotating portion = slots[1..m-1]
  const base = slots.slice(1);
  const r = base.length; // m - 1

  // Apply roundIndex rotations (each rotation moves last element to front)
  const offset = roundIndex % r;
  const rotated =
    offset === 0
      ? [...base]
      : [...base.slice(r - offset), ...base.slice(0, r - offset)];

  const pairs: { p1: typeof players[0]; p2: typeof players[0] }[] = [];

  // Pair the fixed slot with rotated[0]
  if (fixed !== null && rotated[0] !== null) {
    pairs.push({ p1: fixed, p2: rotated[0] });
  }

  // Pair the remaining slots symmetrically
  for (let i = 1; i < m / 2; i++) {
    const a = rotated[i];
    const b = rotated[m - 1 - i];
    if (a !== null && b !== null) {
      pairs.push({ p1: a, p2: b });
    }
  }

  return pairs;
}

/**
 * Constraint-aware perfect matching via backtracking.
 *
 * Finds a set of [id, id] pairs covering every player in `playerIds` exactly
 * once where no pair key (ids sorted and joined with "-") exists in
 * `usedPairKeys`. Returns null when no valid matching exists (all pairs
 * exhausted — only possible for very small or nearly-complete leagues).
 *
 * Used as a fallback inside generateAllRounds when the circle-method rotation
 * would produce a rematch because earlier rounds were generated with a
 * different player ordering.
 */
export function constrainedPerfectMatch(
  playerIds: number[],
  usedPairKeys: Set<string>
): [number, number][] | null {
  if (playerIds.length === 0) return [];
  if (playerIds.length % 2 !== 0) return null;

  const result: [number, number][] = [];

  function bt(remaining: number[]): boolean {
    if (remaining.length === 0) return true;
    const first = remaining[0];
    for (let i = 1; i < remaining.length; i++) {
      const partner = remaining[i];
      const key = [first, partner].sort().join("-");
      if (!usedPairKeys.has(key)) {
        result.push([first, partner]);
        const next = [...remaining.slice(1, i), ...remaining.slice(i + 1)];
        if (bt(next)) return true;
        result.pop();
      }
    }
    return false;
  }

  return bt([...playerIds]) ? result : null;
}

/**
 * Generates all remaining rounds up to `totalRounds` for a league in one call.
 * Already-existing rounds are left untouched; only missing rounds are created.
 * Round 1 (or the first new round whose window includes today) gets status "active";
 * all future rounds get status "upcoming".
 *
 * The circle-method is used as the primary pairing strategy. When existing rounds
 * were generated with a different player ordering (causing the circle-method rotation
 * to produce a repeat), the function falls back to a constraint-aware backtracking
 * matcher that avoids all previously-played pairs.
 */
export async function generateAllRounds(
  leagueId: number,
  totalRounds = 6
): Promise<GeneratedRound[]> {
  const players = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.leagueId, leagueId))
    .orderBy(asc(playersTable.id));

  if (players.length < 2) {
    throw new Error("Need at least 2 players to generate rounds");
  }

  const existingRounds = await db
    .select()
    .from(leagueRoundsTable)
    .where(eq(leagueRoundsTable.leagueId, leagueId))
    .orderBy(asc(leagueRoundsTable.roundNumber));

  if (existingRounds.length >= totalRounds) {
    return Promise.all(existingRounds.map(buildRoundResponse));
  }

  // Build a running count of how many times each pair has been matched
  // across all existing matches (completed or scheduled) so we avoid repeats.
  const pairTimesPlayed = new Map<string, number>();
  const allExistingMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.leagueId, leagueId));
  for (const m of allExistingMatches) {
    const key = [m.player1Id, m.player2Id].sort().join("-");
    pairTimesPlayed.set(key, (pairTimesPlayed.get(key) ?? 0) + 1);
  }

  // Determine the start date for the first new round
  const today = new Date();
  const todayStr = isoDate(today);
  let nextStart: Date;
  if (existingRounds.length > 0) {
    const lastEnd = existingRounds[existingRounds.length - 1].endDate;
    nextStart = new Date(lastEnd);
    nextStart.setDate(nextStart.getDate() + 1);
  } else {
    nextStart = new Date(today);
  }

  const newRounds: GeneratedRound[] = [];
  const toGenerate = totalRounds - existingRounds.length;
  const autoSeason = await getAutoSeason(leagueId);
  const playerIds = players.map((p) => p.id);
  const playerMap = new Map(players.map((p) => [p.id, p]));

  for (let i = 0; i < toGenerate; i++) {
    const roundNumber = existingRounds.length + i + 1;
    const roundStart = isoDate(nextStart);
    const roundEnd = isoDate(addDays(nextStart, 14));

    // Active if today falls within this round's window, otherwise upcoming
    const status = roundStart <= todayStr && roundEnd >= todayStr ? "active" : "upcoming";

    // Build the current used-pair set for the fallback algorithm.
    // Include pairs already committed in this generation batch (tracked via pairTimesPlayed).
    const usedPairKeys = new Set(
      [...pairTimesPlayed.entries()]
        .filter(([, count]) => count > 0)
        .map(([key]) => key)
    );

    // Primary strategy: circle-method (Berger tables) rotation.
    // Use roundIndex = existingRounds.length + i so the rotation continues
    // from where existing rounds left off when all rounds share the same
    // sorted player ordering.
    const roundIndex = existingRounds.length + i;
    const circlePairs = circleMethodPairs(players, roundIndex);

    // Check whether any circle-method pair would be a rematch.
    const circleHasRepeat = circlePairs.some(({ p1, p2 }) =>
      usedPairKeys.has([p1.id, p2.id].sort().join("-"))
    );

    let selectedPairs: { p1: typeof players[0]; p2: typeof players[0] }[];

    if (!circleHasRepeat) {
      selectedPairs = circlePairs;
    } else {
      // Fallback: constraint-aware backtracking matcher.
      // Finds a perfect matching from scratch that avoids all used pairs.
      logger.info(
        { leagueId, roundNumber },
        "Circle-method would produce a rematch — falling back to constraint-aware matching"
      );
      const fallbackIds = constrainedPerfectMatch(playerIds, usedPairKeys);
      if (fallbackIds) {
        selectedPairs = fallbackIds.map(([a, b]) => ({
          p1: playerMap.get(a)!,
          p2: playerMap.get(b)!,
        }));
      } else {
        // All unique pairs exhausted — this round will necessarily have rematches.
        // Use circle-method as a best-effort fallback.
        logger.warn(
          { leagueId, roundNumber },
          "All unique pairs exhausted — using circle-method best-effort for this round"
        );
        selectedPairs = circlePairs;
      }
    }

    const [newRound] = await db.insert(leagueRoundsTable).values({
      leagueId,
      roundNumber,
      startDate: roundStart,
      endDate: roundEnd,
      status,
    }).returning();

    const matchups: GeneratedRound["matchups"] = [];
    for (const { p1, p2 } of selectedPairs) {
      const [match] = await db.insert(matchesTable).values({
        leagueId,
        player1Id: p1.id,
        player2Id: p2.id,
        status: "scheduled",
        generatedFrom: "round",
        weekOf: roundStart,
        roundId: newRound.id,
        ...(autoSeason ? { season: autoSeason } : {}),
      }).returning();

      matchups.push({
        matchId: match.id,
        player1Id: p1.id,
        player1Name: p1.name,
        player2Id: p2.id,
        player2Name: p2.name,
        status: match.status,
        score: match.score ?? null,
        winnerId: match.winnerId ?? null,
        scheduledAt: match.scheduledAt ?? null,
      });

      // Track this pairing so subsequent rounds in the batch avoid repeating it.
      const key = [p1.id, p2.id].sort().join("-");
      pairTimesPlayed.set(key, (pairTimesPlayed.get(key) ?? 0) + 1);
    }

    newRounds.push({
      roundId: newRound.id,
      roundNumber,
      startDate: roundStart,
      endDate: roundEnd,
      status,
      leagueId,
      matchups,
    });

    nextStart = addDays(nextStart, 14);
  }

  logger.info(
    { leagueId, newRoundsGenerated: newRounds.length, totalRounds },
    "All rounds generated upfront"
  );
  return newRounds;
}

/** Legacy single-round generator — kept for the scheduler fallback path. */
export async function generateRound(leagueId: number): Promise<GeneratedRound> {
  const rounds = await generateAllRounds(leagueId, 6);
  // Return the first newly-created active/upcoming round, or the latest existing one
  return rounds[rounds.length - 1] ?? (() => { throw new Error("No round generated"); })();
}

export async function buildRoundResponse(
  round: typeof leagueRoundsTable.$inferSelect
): Promise<GeneratedRound> {
  const roundMatches = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.roundId, round.id));

  const players = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(inArray(playersTable.id, roundMatches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id].filter((id): id is number => id != null))));
  const playerMap: Record<number, string> = {};
  for (const p of players) playerMap[p.id] = p.name;

  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    startDate: round.startDate,
    endDate: round.endDate,
    status: round.status,
    leagueId: round.leagueId,
    matchups: roundMatches.map((m) => ({
      matchId: m.id,
      player1Id: m.player1Id,
      player1Name: playerMap[m.player1Id] ?? "Unknown",
      player2Id: m.player2Id,
      player2Name: playerMap[m.player2Id] ?? "Unknown",
      status: m.status,
      score: m.score ?? null,
      winnerId: m.winnerId ?? null,
      scheduledAt: m.scheduledAt ?? null,
    })),
  };
}
