// Admin edits to a round before it goes out (spec: Leagues > Weekly loop, step
// 2: swap pairings, mark a bye, or lock a match before publishing). Each
// function plans the change and returns plain-English problems; the service
// applies the plan. Pure, so it's easy to test.

export interface DraftMatch {
  id: number;
  player1Id: number;
  player2Id: number;
  locked: boolean;
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
  const placed = new Set<number>([...round.matches.flatMap((m) => [m.player1Id, m.player2Id]), ...round.byes.map((b) => b.playerId)]);
  return round.activePlayerIds.filter((id) => !placed.has(id));
}

type Spot =
  | { kind: "match"; match: DraftMatch; side: 1 | 2 }
  | { kind: "bye"; bye: DraftBye }
  | { kind: "unpaired" }
  | { kind: "absent" };

function spotOf(round: DraftRound, playerId: number): Spot {
  for (const match of round.matches) {
    if (match.player1Id === playerId) return { kind: "match", match, side: 1 };
    if (match.player2Id === playerId) return { kind: "match", match, side: 2 };
  }
  const bye = round.byes.find((b) => b.playerId === playerId);
  if (bye) return { kind: "bye", bye };
  return round.activePlayerIds.includes(playerId) ? { kind: "unpaired" } : { kind: "absent" };
}

export interface SwapPlan {
  matchUpdates: { matchId: number; player1Id: number; player2Id: number }[];
  byeMoves: { fromPlayerId: number; toPlayerId: number }[];
}

function editable(round: DraftRound): string | null {
  return round.published ? "This round has already gone out to players." : null;
}

function place(match: DraftMatch, side: 1 | 2, playerId: number) {
  return side === 1
    ? { matchId: match.id, player1Id: playerId, player2Id: match.player2Id }
    : { matchId: match.id, player1Id: match.player1Id, player2Id: playerId };
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
  if (sa.kind === "match" && sb.kind === "match" && sa.match.id === sb.match.id) {
    return { error: "Those players are already playing each other." };
  }

  const plan: SwapPlan = { matchUpdates: [], byeMoves: [] };
  if (sa.kind === "match" && sb.kind === "match") {
    plan.matchUpdates.push(place(sa.match, sa.side, b), place(sb.match, sb.side, a));
  } else if (sa.kind === "match" || sb.kind === "match") {
    const [inMatch, other, matchSpot, otherSpot] =
      sa.kind === "match" ? [a, b, sa, sb] : [b, a, sb as Extract<Spot, { kind: "match" }>, sa];
    plan.matchUpdates.push(place(matchSpot.match, matchSpot.side, other));
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
