// Ball Boi Rating: a player's level for matching (Discover, Open league ranges,
// Flex pairings), on the NTRP scale. Spec: Ball Boi Rating.
//
// It's a level, not a score: the quiz sets it (Self-rated), a UTR link sets it
// (Verified), and the player can change it anytime. Match results don't move it.

/** Levels the quiz can set. The app shows a plain-language description for each. */
export const QUIZ_RATINGS = [2.5, 3.0, 3.5, 4.0, 4.5] as const;

export function isQuizRating(v: unknown): v is (typeof QUIZ_RATINGS)[number] {
  return typeof v === "number" && (QUIZ_RATINGS as readonly number[]).includes(v);
}
