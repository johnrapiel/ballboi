import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { isQuizRating } from "../lib/rating";

// Ball Boi Rating. Spec: Ball Boi Rating and onboarding step 5.
// The rating is a level for matching. Players set it with the quiz during
// onboarding and can change it anytime; results never move it.

const logger = pino({ name: "ratings" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * POST /users/me/rating/self { rating }
 * Sets the player's level from the quiz, labeled Self-rated. Allowed anytime,
 * unless a linked UTR account sets it (Verified).
 */
router.post("/users/me/rating/self", requireAuth, async (req, res) => {
  const userId = getAuth(req).userId!;
  const rating = req.body?.rating;
  if (!isQuizRating(rating)) {
    res.status(400).json({ error: "Pick one of the descriptions." });
    return;
  }
  try {
    const [user] = await db
      .select({ ratingSource: usersTable.ratingSource })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, userId));
    if (!user) {
      res.status(404).json({ error: "Set up your profile first." });
      return;
    }
    if (user.ratingSource === "verified") {
      res.status(409).json({ error: "Your rating comes from your linked UTR account." });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ rating, ratingSource: "self" })
      .where(eq(usersTable.clerkUserId, userId))
      .returning({ rating: usersTable.rating, ratingSource: usersTable.ratingSource });
    res.json({ rating: updated.rating, source: updated.ratingSource });
  } catch (err) {
    logger.error({ err }, "Self rating failed");
    res.status(500).json({ error: "We couldn't save your rating. Try again." });
  }
});

export default router;
