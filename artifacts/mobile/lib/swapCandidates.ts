// Round review's "Swap Maya Chen with" list (Wave 2 finding 35): everyone else
// placed in the round, closest level first, never the player themselves or the
// opponent they already have (swapping with them changes nothing).

export interface SwapPerson {
  playerId: number;
  name: string;
}

/** A level like "3.5" as a number, or null when there isn't one. */
export function levelNumber(level: string | null | undefined): number | null {
  if (level == null) return null;
  const n = Number.parseFloat(level);
  return Number.isFinite(n) ? n : null;
}

/**
 * Who `player` can swap with. Sorted by how far each level is from the
 * player's (nearest first), then by name. Anyone without a level goes last;
 * when the player has no level the list is by name.
 */
export function swapCandidates<P extends SwapPerson>(
  everyone: P[],
  player: SwapPerson,
  opponentId: number | null,
  levelOf: (playerId: number) => string | null | undefined,
): P[] {
  const mine = levelNumber(levelOf(player.playerId));
  const seen = new Set<number>();
  const others = everyone.filter((p) => {
    if (p.playerId === player.playerId || p.playerId === opponentId || seen.has(p.playerId)) return false;
    seen.add(p.playerId);
    return true;
  });
  const gap = (p: P) => {
    const theirs = levelNumber(levelOf(p.playerId));
    if (theirs == null) return Number.POSITIVE_INFINITY;
    return mine == null ? 0 : Math.abs(theirs - mine);
  };
  return others
    .map((p) => ({ p, d: gap(p) }))
    .sort((a, b) => (a.d === b.d ? a.p.name.localeCompare(b.p.name) : a.d - b.d))
    .map((x) => x.p);
}
