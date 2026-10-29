// Ball Boi Rating: reads and writes. The math lives in lib/rating.ts.
// Spec: Ball Boi Rating, plus decisions 24 (the first score entered stands)
// and 25 (grace-period matches still update ratings).

import { db, ratingHistoryTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rateMatch, type MatchSide, type RatingChange } from "../lib/rating";

type Db = typeof db;

export class RatingError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "RatingError";
  }
}

/**
 * Set a starting rating from the onboarding quiz. Labeled Self-rated.
 * Allowed until results start moving the rating or a UTR link verifies it, so
 * someone can retake the quiz during onboarding without resetting real results.
 */
export async function setSelfRating(clerkUserId: string, rating: number, database: Db = db) {
  return database.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id, ratingSource: usersTable.ratingSource })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId));
    if (!user) throw new RatingError("Set up your profile first.", 404);
    if (user.ratingSource === "verified") {
      throw new RatingError("Your rating comes from your linked UTR account.", 409);
    }
    const [played] = await tx
      .select({ id: ratingHistoryTable.id })
      .from(ratingHistoryTable)
      .where(and(eq(ratingHistoryTable.clerkUserId, clerkUserId), eq(ratingHistoryTable.reason, "match")))
      .limit(1);
    if (played) {
      throw new RatingError("Your rating now moves with your results.", 409);
    }

    // Retaking the quiz replaces the earlier quiz answer rather than stacking rows.
    await tx
      .delete(ratingHistoryTable)
      .where(and(eq(ratingHistoryTable.clerkUserId, clerkUserId), eq(ratingHistoryTable.reason, "self_rated")));
    await tx.insert(ratingHistoryTable).values({ clerkUserId, rating, delta: 0, reason: "self_rated", weight: 1 });
    const [updated] = await tx
      .update(usersTable)
      .set({ rating, ratingSource: "self" })
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .returning({ rating: usersTable.rating, ratingSource: usersTable.ratingSource });
    return updated;
  });
}

export interface MatchResultInput {
  matchId: number;
  /** Clerk user IDs on each side: one each for singles, two each for doubles. */
  sides: [string[], string[]];
  /** 0 if the first side won, 1 if the second did. */
  winner: 0 | 1;
}

export type MatchResultOutcome =
  | { applied: true; changes: RatingChange[] }
  | { applied: false; reason: "already_rated" | "unrated_player" };

/**
 * Move every player's rating for one entered score. Call it once, when the
 * first score is entered (decision 24), including for matches played in a
 * league's grace period (decision 25).
 *
 * Skips the match, changing nothing, when:
 * - it already moved ratings (safe to call twice), or
 * - anyone on it has no Ball Boi account or no rating yet, such as a Quick
 *   match placeholder opponent who hasn't joined.
 */
export async function applyMatchResult(input: MatchResultInput, database: Db = db): Promise<MatchResultOutcome> {
  const ids = [...input.sides[0], ...input.sides[1]];
  if (input.sides[0].length === 0 || input.sides[1].length === 0 || new Set(ids).size !== ids.length) {
    throw new Error("Each side needs at least one player, and no player can be on both sides");
  }

  return database.transaction(async (tx) => {
    const done = await tx
      .select({ id: ratingHistoryTable.id })
      .from(ratingHistoryTable)
      .where(and(eq(ratingHistoryTable.matchId, input.matchId), inArray(ratingHistoryTable.clerkUserId, ids)))
      .limit(1);
    if (done.length) return { applied: false, reason: "already_rated" } as const;

    const users = await tx
      .select({ clerkUserId: usersTable.clerkUserId, rating: usersTable.rating })
      .from(usersTable)
      .where(inArray(usersTable.clerkUserId, ids));
    const ratingOf = new Map(users.map((u) => [u.clerkUserId, u.rating]));
    if (ids.some((id) => ratingOf.get(id) == null)) return { applied: false, reason: "unrated_player" } as const;

    const side = (players: string[]): MatchSide => ({
      players: players.map((clerkUserId) => ({ clerkUserId, rating: ratingOf.get(clerkUserId)! })),
    });
    const changes = rateMatch([side(input.sides[0]), side(input.sides[1])], input.winner);

    await tx.insert(ratingHistoryTable).values(
      changes.map((c) => ({
        clerkUserId: c.clerkUserId,
        rating: c.after,
        delta: c.delta,
        reason: "match" as const,
        matchId: input.matchId,
        weight: c.weight,
      })),
    );
    for (const c of changes) {
      await tx.update(usersTable).set({ rating: c.after }).where(eq(usersTable.clerkUserId, c.clerkUserId));
    }
    return { applied: true, changes } as const;
  });
}

/** Current rating plus every change, oldest first, for the profile trend line. */
export async function getRating(clerkUserId: string, database: Db = db) {
  const [user] = await database
    .select({ rating: usersTable.rating, ratingSource: usersTable.ratingSource })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  if (!user) return null;
  const history = await database
    .select({
      rating: ratingHistoryTable.rating,
      delta: ratingHistoryTable.delta,
      reason: ratingHistoryTable.reason,
      matchId: ratingHistoryTable.matchId,
      weight: ratingHistoryTable.weight,
      createdAt: ratingHistoryTable.createdAt,
    })
    .from(ratingHistoryTable)
    .where(eq(ratingHistoryTable.clerkUserId, clerkUserId))
    .orderBy(asc(ratingHistoryTable.createdAt), asc(ratingHistoryTable.id));
  return { rating: user.rating, source: user.ratingSource, history };
}
