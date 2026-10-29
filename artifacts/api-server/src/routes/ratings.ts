import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import pino from "pino";
import { isQuizRating } from "../lib/rating";
import { RatingError, getRating, setSelfRating } from "../services/ratingService";

// Ball Boi Rating endpoints. Spec: Ball Boi Rating and onboarding step 5.
// Rating changes from entered scores happen server-side in
// services/ratingService.ts (applyMatchResult), never from the app.

const logger = pino({ name: "ratings" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** GET /users/me/rating: current rating, Self-rated or Verified, and history. */
router.get("/users/me/rating", requireAuth, async (req, res) => {
  const result = await getRating(getAuth(req).userId!);
  if (!result) {
    res.status(404).json({ error: "User profile not found" });
    return;
  }
  res.json(result);
});

/** POST /users/me/rating/self { rating }: starting rating from the onboarding quiz. */
router.post("/users/me/rating/self", requireAuth, async (req, res) => {
  const rating = req.body?.rating;
  if (!isQuizRating(rating)) {
    res.status(400).json({ error: "Pick one of the descriptions." });
    return;
  }
  try {
    const updated = await setSelfRating(getAuth(req).userId!, rating);
    res.json({ rating: updated.rating, source: updated.ratingSource });
  } catch (err) {
    if (err instanceof RatingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Self rating failed");
    res.status(500).json({ error: "We couldn't save your rating. Try again." });
  }
});

export default router;
