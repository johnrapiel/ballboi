// Admin edits to a round before it goes out (spec: Leagues > Weekly loop, step
// 2: swap pairings, mark a bye, or lock a match before publishing). Each
// function plans the change and returns plain-English problems; the service
// applies the plan. Pure, so it's easy to test.
//
// Doubles (Wave 2): a match has four spots, side 1 as player1 + player3 and
// side 2 as player2 + player4. A swap moves a player into another's spot, so
// in doubles it can also swap partners and opponents within one match.

export interface DraftMatch {
  id: number;
  player1Id: number;
  player2Id: number;
  /** Doubles only: player1's partner. */
  player3Id?: number | null;
  /** Doubles only: player2's partner. */
  player4Id?: number | null;
  locked: boolean;
}

type Slot = 1 | 2 | 3 | 4;

function slotsOf(m: DraftMatch): [Slot, number][] {
  const out: [Slot, number][] = [[1, m.player1Id], [2, m.player2Id]];
  if (m.player3Id != null) out.push([3, m.player3Id]);
  if (m.player4Id != null) out.push([4, m.player4Id]);
  return out;
}

/** Everyone in a match: two for singles, four for doubles. */
export function draftMatchPlayers(m: DraftMatch): number[] {
  return slotsOf(m).map(([, id]) => id);
}

export interface DraftBye {
  playerId: number;
  setByAdmin: boolean;
}

export interface DraftRound {
  published: boolean;
  matches: DraftMatch[];
  byes: DraftBye[];
  /** Everyone playing in the league this week. */
  activePlayerIds: number[];
}

/** Active players with no match and no bye in this round yet. */
export function unpairedPlayers(round: DraftRound): number[] {
  const placed = new Set<number>([...round.matches.flatMap(draftMatchPlayers), ...round.byes.map((b) => b.playerId)]);
  return round.activePlayerIds.filter((id) => !placed.has(id));
}

type Spot =
  | { kind: "match"; match: DraftMatch; slot: Slot }
  | { kind: "bye"; bye: DraftBye }
  | { kind: "unpaired" }
  | { kind: "absent" };

function spotOf(round: DraftRound, playerId: number): Spot {
  for (const match of round.matches) {
    const found = slotsOf(match).find(([, id]) => id === playerId);
    if (found) return { kind: "match", match, slot: found[0] };
  }
  const bye = round.byes.find((b) => b.playerId === playerId);
  if (bye) return { kind: "bye", bye };
  return round.activePlayerIds.includes(playerId) ? { kind: "unpaired" } : { kind: "absent" };
}

export interface MatchUpdate {
  matchId: number;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
}

export interface SwapPlan {
  matchUpdates: MatchUpdate[];
  byeMoves: { fromPlayerId: number; toPlayerId: number }[];
}

function editable(round: DraftRound): string | null {
  return round.published ? "This round has already gone out to players." : null;
}

function current(match: DraftMatch): MatchUpdate {
  return {
    matchId: match.id,
    player1Id: match.player1Id,
    player2Id: match.player2Id,
    player3Id: match.player3Id ?? null,
    player4Id: match.player4Id ?? null,
  };
}

function setSlot(u: MatchUpdate, slot: Slot, playerId: number): MatchUpdate {
  const key = (["player1Id", "player2Id", "player3Id", "player4Id"] as const)[slot - 1];
  return { ...u, [key]: playerId };
}

function place(match: DraftMatch, slot: Slot, playerId: number): MatchUpdate {
  return setSlot(current(match), slot, playerId);
}

/** Swap two players' places: between matches, with a bye, or with someone unpaired. */
export function planSwap(round: DraftRound, a: number, b: number): SwapPlan | { error: string } {
  const problem = editable(round);
  if (problem) return { error: problem };
  if (a === b) return { error: "Pick two different players to swap." };
  const sa = spotOf(round, a);
  const sb = spotOf(round, b);
  if (sa.kind === "absent" || sb.kind === "absent") return { error: "Both players need to be in this league." };
  for (const s of [sa, sb]) {
    if (s.kind === "match" && s.match.locked) return { error: "Unlock that match before changing it." };
  }
  const plan: SwapPlan = { matchUpdates: [], byeMoves: [] };
  if (sa.kind === "match" && sb.kind === "match" && sa.match.id === sb.match.id) {
    // Doubles: swapping within a match changes who partners whom.
    const sameSide = (sa.slot % 2) === (sb.slot % 2);
    if (sa.match.player3Id == null || sameSide) return { error: "Those players are already playing each other." };
    plan.matchUpdates.push(setSlot(place(sa.match, sa.slot, b), sb.slot, a));
    return plan;
  }

  if (sa.kind === "match" && sb.kind === "match") {
    plan.matchUpdates.push(place(sa.match, sa.slot, b), place(sb.match, sb.slot, a));
  } else if (sa.kind === "match" || sb.kind === "match") {
    const [inMatch, other, matchSpot, otherSpot] =
      sa.kind === "match" ? [a, b, sa, sb] : [b, a, sb as Extract<Spot, { kind: "match" }>, sa];
    plan.matchUpdates.push(place(matchSpot.match, matchSpot.slot, other));
    if (otherSpot.kind === "bye") plan.byeMoves.push({ fromPlayerId: other, toPlayerId: inMatch });
  } else {
    return { error: "Neither player has a match to swap." };
  }
  return plan;
}

/** Give a player a bye. Their opponent is left unpaired until the round is re-paired or goes out. */
export function planBye(round: DraftRound, playerId: number): { deleteMatchId: number | null } | { error: string } {
  const problem = editable(round);
  if (problem) return { error: problem };
  const spot = spotOf(round, playerId);
  if (spot.kind === "absent") return { error: "That player isn't in this league." };
  if (spot.kind === "bye") return { error: "That player already has a bye this round." };
  if (spot.kind === "match" && spot.match.locked) return { error: "Unlock that match before changing it." };
  return { deleteMatchId: spot.kind === "match" ? spot.match.id : null };
}

/** Lock or unlock a pairing so a re-pair keeps it. */
export function planLock(round: DraftRound, matchId: number): string | null {
  const problem = editable(round);
  if (problem) return problem;
  return round.matches.some((m) => m.id === matchId) ? null : "That match isn't in this round.";
}
