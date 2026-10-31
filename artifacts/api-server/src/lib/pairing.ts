// Weekly league pairing (spec: Leagues > Weekly loop). Pure, so it's easy to test.
//
// Flex pairs players each week by rating, availability, and who hasn't played
// whom. Round robin uses the same engine with "who hasn't played whom" as the
// only goal, so over a season everyone meets everyone once where the roster
// allows it. Admins can lock pairings and mark byes before a round goes out;
// those are kept as they are and everyone else is paired around them.

export interface PairingPlayer {
  id: number;
  /** NTRP-scale rating, e.g. 3.5. */
  rating: number;
  /** When they can play this week, as "day-hour" keys; null when not set. */
  slots: string[] | null;
  /** Byes they've had so far this season. */
  byes: number;
}

export interface PairingWeights {
  /** Cost per earlier meeting between the two players. */
  rematch: number;
  /** Cost per 1.0 of rating difference. */
  rating: number;
  /** Cost when both set availability and share no time. */
  availability: number;
}

export const FLEX_WEIGHTS: PairingWeights = { rematch: 10, rating: 4, availability: 3 };
export const ROUND_ROBIN_WEIGHTS: PairingWeights = { rematch: 100, rating: 0, availability: 0 };

export interface PairingInput {
  players: PairingPlayer[];
  /** Times each pair has already met, keyed by pairKey(). */
  history: Map<string, number>;
  weights: PairingWeights;
  /** Pairings an admin locked: kept exactly. */
  lockedPairs?: [number, number][];
  /** Players an admin gave a bye: kept exactly. */
  lockedByes?: number[];
  /** Used to rotate who gets the bye among equally deserving players. */
  roundNumber: number;
}

export interface PairingResult {
  pairs: [number, number][];
  byes: number[];
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function pairCost(a: PairingPlayer, b: PairingPlayer, history: Map<string, number>, w: PairingWeights): number {
  let cost = (history.get(pairKey(a.id, b.id)) ?? 0) * w.rematch;
  cost += Math.abs(a.rating - b.rating) * w.rating;
  if (a.slots && b.slots && a.slots.length && b.slots.length) {
    const theirs = new Set(b.slots);
    if (!a.slots.some((s) => theirs.has(s))) cost += w.availability;
  }
  return cost;
}

/** Above this many players, an exact search gets slow, so we improve a greedy matching instead. */
const EXACT_LIMIT = 18;

/** Minimum-cost perfect matching over an even list of players. */
export function minCostMatching(players: PairingPlayer[], cost: (a: PairingPlayer, b: PairingPlayer) => number): [number, number][] {
  const n = players.length;
  if (n === 0) return [];
  if (n % 2 !== 0) throw new Error("Need an even number of players to pair");

  const c: number[][] = players.map((a) => players.map((b) => (a === b ? 0 : cost(a, b))));

  if (n <= EXACT_LIMIT) {
    // dp over the set of players still to pair: always pair the lowest one left.
    const full = (1 << n) - 1;
    const best = new Float64Array(1 << n).fill(Infinity);
    const choice = new Int8Array(1 << n).fill(-1);
    best[0] = 0;
    // Masks with an even number of bits, in increasing order, only depend on smaller masks.
    for (let mask = 1; mask <= full; mask++) {
      let i = 0;
      while (!(mask & (1 << i))) i++;
      const rest = mask & ~(1 << i);
      for (let j = i + 1; j < n; j++) {
        if (!(rest & (1 << j))) continue;
        const sub = rest & ~(1 << j);
        const total = best[sub] + c[i][j];
        if (total < best[mask]) {
          best[mask] = total;
          choice[mask] = j;
        }
      }
    }
    const pairs: [number, number][] = [];
    let mask = full;
    while (mask) {
      let i = 0;
      while (!(mask & (1 << i))) i++;
      const j = choice[mask];
      pairs.push([players[i].id, players[j].id]);
      mask &= ~((1 << i) | (1 << j));
    }
    return pairs;
  }

  // Greedy: cheapest pairs first, then swap partners between two pairs while it helps.
  const edges: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([c[i][j], i, j]);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const used = new Array<boolean>(n).fill(false);
  const idx: [number, number][] = [];
  for (const [, i, j] of edges) {
    if (used[i] || used[j]) continue;
    used[i] = used[j] = true;
    idx.push([i, j]);
  }
  for (let pass = 0, improved = true; improved && pass < 100; pass++) {
    improved = false;
    for (let p = 0; p < idx.length; p++) {
      for (let q = p + 1; q < idx.length; q++) {
        const [a, b] = idx[p];
        const [x, y] = idx[q];
        const now = c[a][b] + c[x][y];
        if (c[a][x] + c[b][y] < now - 1e-9) {
          idx[p] = [a, x];
          idx[q] = [b, y];
          improved = true;
        } else if (c[a][y] + c[b][x] < now - 1e-9) {
          idx[p] = [a, y];
          idx[q] = [b, x];
          improved = true;
        }
      }
    }
  }
  return idx.map(([i, j]) => [players[i].id, players[j].id]);
}

/** Pairs a round. Locked pairings and byes stay; with an odd number left, one player sits out. */
export function pairRound(input: PairingInput): PairingResult {
  const lockedPairs = input.lockedPairs ?? [];
  const lockedByes = input.lockedByes ?? [];
  const taken = new Set<number>([...lockedPairs.flat(), ...lockedByes]);
  let open = input.players.filter((p) => !taken.has(p.id)).sort((a, b) => a.id - b.id);

  const byes = [...lockedByes];
  if (open.length % 2 === 1) {
    // Fewest byes so far sits out, rotating by round among those tied.
    const fewest = Math.min(...open.map((p) => p.byes));
    const candidates = open.filter((p) => p.byes === fewest);
    const sitter = candidates[(input.roundNumber - 1) % candidates.length];
    byes.push(sitter.id);
    open = open.filter((p) => p.id !== sitter.id);
  }

  const pairs = minCostMatching(open, (a, b) => pairCost(a, b, input.history, input.weights));
  return { pairs: [...lockedPairs, ...pairs], byes };
}

/** "3.5" to 3.5; anything unreadable counts as 3.0, the default starting rating. */
export function ratingValue(skillLevel: string | null | undefined): number {
  const n = Number(skillLevel);
  return Number.isFinite(n) && n > 0 ? n : 3.0;
}

/** Availability slots ({ dayOfWeek, hour }) as "day-hour" keys. */
export function slotKeys(slots: { dayOfWeek: number; hour: number }[] | null | undefined): string[] | null {
  if (!slots || slots.length === 0) return null;
  return slots.map((s) => `${s.dayOfWeek}-${s.hour}`);
}
