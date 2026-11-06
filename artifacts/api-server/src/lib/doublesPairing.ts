// Weekly doubles pairing (spec: Leagues > Setup > Play type: fixed-partner or
// rotating-partner doubles; Weekly loop). Pure, so it's easy to test. Built on
// the singles engine in pairing.ts, with the same weights per format.
//
// Teams are stored on a match as player1 + player3 (side 1) against
// player2 + player4 (side 2), the same convention scoring and standings use.
//
// - Rotating partners: each week players are grouped in fours by level,
//   availability and who hasn't played with or against whom, then split into
//   the two most even teams, preferring partners who haven't teamed up yet.
//   With a number that isn't a multiple of 4, the 1 to 3 left over sit out,
//   fewest byes first.
// - Fixed partners: each team plays as one unit through the season, paired
//   with the singles engine (team level is the partners' average). With an
//   odd number of teams, one team sits out.
//
// Blocks (B10) carry over: two players where either blocked the other never
// share a court, as partners or opponents. When there's no other way, the
// four in that match sit out instead.

import { minCostMatching, pairKey, pairRound, type PairingPlayer, type PairingWeights } from "./pairing.js";

export interface DoublesMatchup {
  /** Side 1: stored as player1 and player3. */
  team1: [number, number];
  /** Side 2: stored as player2 and player4. */
  team2: [number, number];
}

export interface DoublesResult {
  matches: DoublesMatchup[];
  byes: number[];
}

export interface DoublesHistory {
  /** Times two players were on opposite sides, keyed by pairKey(). */
  opponents: Map<string, number>;
  /** Times two players were partners, keyed by pairKey(). */
  partners: Map<string, number>;
}

export interface MatchSides {
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
}

function bump(map: Map<string, number>, a: number, b: number) {
  const key = pairKey(a, b);
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Who has played with and against whom, from a league's matches. Works for singles rows too. */
export function doublesHistory(matches: MatchSides[]): DoublesHistory {
  const opponents = new Map<string, number>();
  const partners = new Map<string, number>();
  for (const m of matches) {
    const side1 = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
    const side2 = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
    for (const a of side1) for (const b of side2) bump(opponents, a, b);
    if (side1.length === 2) bump(partners, side1[0], side1[1]);
    if (side2.length === 2) bump(partners, side2[0], side2[1]);
  }
  return { opponents, partners };
}

/** Far above any real cost, so a blocked pair is only chosen when nothing else works. */
const BLOCKED_COST = 1e9;

function meetings(h: DoublesHistory, a: number, b: number): number {
  const key = pairKey(a, b);
  return (h.opponents.get(key) ?? 0) + (h.partners.get(key) ?? 0);
}

/** Shared times for a group: the overlap of everyone who set availability, or null if nobody did. */
function sharedSlots(groups: (string[] | null)[]): string[] | null {
  const set = groups.filter((s): s is string[] => !!s && s.length > 0);
  if (set.length === 0) return null;
  return set.reduce((acc, s) => acc.filter((x) => s.includes(x)));
}

function average(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}

/**
 * Who sits out when the count doesn't divide evenly: the fewest byes so far,
 * rotating by round among players tied on byes.
 */
export function pickSitters(players: PairingPlayer[], count: number, roundNumber: number): number[] {
  if (count <= 0) return [];
  const sorted = [...players].sort((a, b) => a.id - b.id);
  const n = sorted.length;
  const shift = ((roundNumber - 1) * count) % Math.max(n, 1);
  return sorted
    .map((p, i) => ({ p, turn: (i - shift + n) % n }))
    .sort((a, b) => a.p.byes - b.p.byes || a.turn - b.turn)
    .slice(0, count)
    .map((x) => x.p.id);
}

/** The three ways to split four players into two teams. */
function splits([a, b, c, d]: number[]): DoublesMatchup[] {
  return [
    { team1: [a, b], team2: [c, d] },
    { team1: [a, c], team2: [b, d] },
    { team1: [a, d], team2: [b, c] },
  ];
}

function splitCost(m: DoublesMatchup, rating: (id: number) => number, h: DoublesHistory, w: PairingWeights): number {
  // Repeat partners cost the most: rotating doubles is about new partners.
  let cost = ((h.partners.get(pairKey(...m.team1)) ?? 0) + (h.partners.get(pairKey(...m.team2)) ?? 0)) * w.rematch * 2;
  for (const a of m.team1) for (const b of m.team2) cost += (h.opponents.get(pairKey(a, b)) ?? 0) * w.rematch;
  // Even teams: the gap between the two teams' average levels. Always counts a
  // little, so Round robin still splits strong with weak.
  const gap = Math.abs(average(m.team1.map(rating)) - average(m.team2.map(rating)));
  return cost + gap * Math.max(w.rating, 1) * 2;
}

/** The most even, freshest split of four players. */
export function bestSplit(four: number[], rating: (id: number) => number, h: DoublesHistory, w: PairingWeights): DoublesMatchup {
  return splits(four)
    .map((m) => ({ m, cost: splitCost(m, rating, h, w) }))
    .reduce((best, x) => (x.cost < best.cost - 1e-9 ? x : best)).m;
}

function anyBlocked(ids: number[], blocked: Set<string>): boolean {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (blocked.has(pairKey(ids[i], ids[j]))) return true;
  return false;
}

export interface RotatingInput {
  players: PairingPlayer[];
  history: DoublesHistory;
  weights: PairingWeights;
  roundNumber: number;
  blocked?: Set<string>;
}

/** Rotating partners: new fours and new partners each week. */
export function pairRotatingDoubles(input: RotatingInput): DoublesResult {
  const blocked = input.blocked ?? new Set<string>();
  const w = input.weights;
  const h = input.history;
  const sitters = pickSitters(input.players, input.players.length % 4, input.roundNumber);
  const open = input.players.filter((p) => !sitters.includes(p.id)).sort((a, b) => a.id - b.id);
  if (open.length < 4) return { matches: [], byes: [...sitters, ...open.map((p) => p.id)] };
  const byId = new Map(open.map((p) => [p.id, p]));
  const rating = (id: number) => byId.get(id)!.rating;

  // 1. Two players who suit the same four: close level, free at the same time.
  const duoCost = (a: PairingPlayer, b: PairingPlayer) => {
    let cost = meetings(h, a.id, b.id) * w.rematch + Math.abs(a.rating - b.rating) * w.rating;
    if (a.slots?.length && b.slots?.length && !a.slots.some((s) => b.slots!.includes(s))) cost += w.availability;
    return cost + (blocked.has(pairKey(a.id, b.id)) ? BLOCKED_COST : 0);
  };
  const duos = minCostMatching(open, duoCost);

  // 2. Two duos make a four.
  const duoUnits: PairingPlayer[] = duos.map(([a, b], i) => ({
    id: i,
    rating: average([rating(a), rating(b)]),
    slots: sharedSlots([byId.get(a)!.slots, byId.get(b)!.slots]),
    byes: 0,
  }));
  const fourCost = (x: PairingPlayer, y: PairingPlayer) => {
    const cross = duos[x.id].flatMap((a) => duos[y.id].map((b) => [a, b] as const));
    let cost = cross.reduce((sum, [a, b]) => sum + meetings(h, a, b), 0) * (w.rematch / 2);
    cost += Math.abs(x.rating - y.rating) * w.rating;
    if (x.slots?.length && y.slots?.length && !x.slots.some((s) => y.slots!.includes(s))) cost += w.availability;
    if (cross.some(([a, b]) => blocked.has(pairKey(a, b)))) cost += BLOCKED_COST;
    return cost;
  };
  const fours = minCostMatching(duoUnits, fourCost).map(([x, y]) => [...duos[x], ...duos[y]]);

  // 3. Split each four into the two most even teams.
  const matches: DoublesMatchup[] = [];
  const byes = [...sitters];
  for (const four of fours) {
    if (anyBlocked(four, blocked)) byes.push(...four);
    else matches.push(bestSplit(four, rating, h, w));
  }
  return { matches, byes };
}

export interface DoublesTeam {
  id: number;
  playerIds: [number, number];
}

/** Times two fixed teams have met, keyed by pairKey() of team ids. */
export function teamMeetings(teams: DoublesTeam[], matches: MatchSides[]): Map<string, number> {
  const teamOf = (ids: (number | null)[]) => {
    const set = ids.filter((id): id is number => id != null);
    if (set.length !== 2) return null;
    return teams.find((t) => t.playerIds.every((id) => set.includes(id)))?.id ?? null;
  };
  const out = new Map<string, number>();
  for (const m of matches) {
    const a = teamOf([m.player1Id, m.player3Id]);
    const b = teamOf([m.player2Id, m.player4Id]);
    if (a != null && b != null) bump(out, a, b);
  }
  return out;
}

export interface FixedInput {
  teams: DoublesTeam[];
  /** Every player on those teams, for level, availability and byes. */
  players: PairingPlayer[];
  /** Times each pair of teams has met, from teamMeetings(). */
  teamHistory: Map<string, number>;
  weights: PairingWeights;
  roundNumber: number;
  /** Player pairs (pairKey) where one blocked the other. */
  blocked?: Set<string>;
}

/** Fixed partners: teams paired against teams with the singles engine. */
export function pairFixedDoubles(input: FixedInput): DoublesResult {
  const blocked = input.blocked ?? new Set<string>();
  const byId = new Map(input.players.map((p) => [p.id, p]));
  const teams = input.teams.filter((t) => t.playerIds.every((id) => byId.has(id)));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const units: PairingPlayer[] = teams.map((t) => {
    const [a, b] = t.playerIds.map((id) => byId.get(id)!);
    return { id: t.id, rating: average([a.rating, b.rating]), slots: sharedSlots([a.slots, b.slots]), byes: Math.max(a.byes, b.byes) };
  });
  const teamBlocked = new Set<string>();
  for (const x of teams) {
    for (const y of teams) {
      if (x.id < y.id && x.playerIds.some((a) => y.playerIds.some((b) => blocked.has(pairKey(a, b))))) teamBlocked.add(pairKey(x.id, y.id));
    }
  }
  const { pairs, byes } = pairRound({
    players: units,
    history: input.teamHistory,
    weights: input.weights,
    roundNumber: input.roundNumber,
    blocked: teamBlocked,
  });
  return {
    matches: pairs.map(([x, y]) => ({ team1: teamById.get(x)!.playerIds, team2: teamById.get(y)!.playerIds })),
    byes: byes.flatMap((id) => teamById.get(id)!.playerIds),
  };
}

/**
 * Teams up players who don't have a partner yet, closest level first, never
 * two players where one blocked the other. With an odd number, the newest
 * player (highest id) waits for a partner.
 */
export function autoTeams(players: PairingPlayer[], blocked: Set<string> = new Set()): { teams: [number, number][]; left: number[] } {
  const sorted = [...players].sort((a, b) => a.id - b.id);
  const left: number[] = [];
  if (sorted.length % 2 === 1) left.push(sorted.pop()!.id);
  const cost = (a: PairingPlayer, b: PairingPlayer) =>
    Math.abs(a.rating - b.rating) + (blocked.has(pairKey(a.id, b.id)) ? BLOCKED_COST : 0);
  const teams: [number, number][] = [];
  for (const [a, b] of minCostMatching(sorted, cost)) {
    if (blocked.has(pairKey(a, b))) left.push(a, b);
    else teams.push(a < b ? [a, b] : [b, a]);
  }
  return { teams, left };
}

/** An admin teaming two players up in Manage. Returns the problem in plain words, or null. */
export function checkNewTeam(input: { teams: DoublesTeam[]; activePlayerIds: number[]; a: number; b: number }): string | null {
  const { teams, activePlayerIds, a, b } = input;
  if (a === b) return "Pick two different players.";
  if (!activePlayerIds.includes(a) || !activePlayerIds.includes(b)) return "Both players need to be in this league.";
  if (teams.some((t) => t.playerIds.includes(a) || t.playerIds.includes(b))) {
    return "One of them already has a partner. Split that team first.";
  }
  return null;
}
