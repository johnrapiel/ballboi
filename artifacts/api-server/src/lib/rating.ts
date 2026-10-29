// Ball Boi Rating math. Pure functions, no database.
// Spec: Ball Boi Rating. One NTRP-scale rating drives all matching. It starts
// from the onboarding quiz (Self-rated) or a UTR link (Verified), then every
// entered score nudges both players' ratings. Doubles count at half weight.
//
// The model is Elo on the NTRP scale:
// - expected = 1 / (1 + 10^((opponent - me) / SCALE))
// - change   = K × weight × (result - expected), result 1 for a win, 0 for a loss
// Two even players move 0.04 each way per singles match, which matches the
// spec's "Rating up 0.04 to 3.54" example. An upset moves more; beating a much
// weaker player moves almost nothing.

/** Lowest and highest ratings. The quiz starts at 2.5; NTRP tops out at 7.0. */
export const RATING_MIN = 2.5;
export const RATING_MAX = 7.0;

/** Most a single singles match can move a rating. */
export const K_FACTOR = 0.08;
/** A 1.0 gap means the higher player is expected to win about 91% of the time. */
export const SCALE = 1.0;

export const SINGLES_WEIGHT = 1;
export const DOUBLES_WEIGHT = 0.5;

/**
 * Starting ratings the onboarding quiz can set. The app shows a plain-language
 * description for each; the server only accepts these values.
 */
export const QUIZ_RATINGS = [2.5, 3.0, 3.5, 4.0, 4.5] as const;

export function isQuizRating(v: unknown): v is (typeof QUIZ_RATINGS)[number] {
  return typeof v === "number" && (QUIZ_RATINGS as readonly number[]).includes(v);
}

/** Round to two decimals, the precision ratings are stored and shown at. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampRating(n: number): number {
  return Math.min(RATING_MAX, Math.max(RATING_MIN, n));
}

/** Chance that a side rated `me` beats a side rated `opponent`. */
export function expectedScore(me: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - me) / SCALE));
}

function average(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}

export interface MatchSide {
  /** Clerk user IDs and their current ratings. One player for singles, two for doubles. */
  players: { clerkUserId: string; rating: number }[];
}

export interface RatingChange {
  clerkUserId: string;
  before: number;
  after: number;
  /** after - before, after clamping and rounding. */
  delta: number;
  weight: number;
}

/**
 * Rating changes for one result. `winner` is 0 or 1 (index into `sides`).
 * Doubles use each team's average rating and give every player on a team the
 * same change at half weight.
 */
export function rateMatch(sides: [MatchSide, MatchSide], winner: 0 | 1): RatingChange[] {
  const [a, b] = sides;
  if (a.players.length === 0 || b.players.length === 0) {
    throw new Error("Both sides need at least one player");
  }
  const doubles = a.players.length > 1 || b.players.length > 1;
  const weight = doubles ? DOUBLES_WEIGHT : SINGLES_WEIGHT;
  const teamA = average(a.players.map((p) => p.rating));
  const teamB = average(b.players.map((p) => p.rating));

  const sideChange = (team: number, opp: number, won: boolean) =>
    K_FACTOR * weight * ((won ? 1 : 0) - expectedScore(team, opp));

  const changeA = sideChange(teamA, teamB, winner === 0);
  const changeB = sideChange(teamB, teamA, winner === 1);

  const apply = (p: { clerkUserId: string; rating: number }, change: number): RatingChange => {
    const before = round2(p.rating);
    const after = round2(clampRating(before + change));
    return { clerkUserId: p.clerkUserId, before, after, delta: round2(after - before), weight };
  };

  return [...a.players.map((p) => apply(p, changeA)), ...b.players.map((p) => apply(p, changeB))];
}
