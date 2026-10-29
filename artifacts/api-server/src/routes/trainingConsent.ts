import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, recordingConsentTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";

// First-recording consent and the training toggle (spec: Video and training
// data). Training is on by default; the choice lives on the server so it
// follows the account and the both-players rule can read it.

const logger = pino({ name: "trainingConsent" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export interface ConsentView {
  consented: boolean;
  consentedAt: string | null;
  trainingEnabled: boolean;
}

export function toConsentView(row: { consentedAt: Date | null; trainingEnabled: boolean } | undefined): ConsentView {
  return {
    consented: !!row?.consentedAt,
    consentedAt: row?.consentedAt ? row.consentedAt.toISOString() : null,
    trainingEnabled: row ? row.trainingEnabled : true,
  };
}

/** GET /recording/consent: has the caller agreed yet, and is training on? */
router.get("/recording/consent", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  try {
    const [row] = await db.select().from(recordingConsentTable).where(eq(recordingConsentTable.clerkUserId, userId));
    res.json(toConsentView(row));
  } catch (err) {
    logger.error({ err }, "Failed to read recording consent");
    res.status(500).json({ error: "Couldn't load your recording settings." });
  }
});

function readTraining(body: unknown): boolean | null {
  const v = (body as { trainingEnabled?: unknown } | null)?.trainingEnabled;
  return typeof v === "boolean" ? v : null;
}

/** POST /recording/consent { trainingEnabled }: agreed on the first-recording screen. */
router.post("/recording/consent", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const trainingEnabled = readTraining(req.body);
  if (trainingEnabled === null) {
    res.status(400).json({ error: "trainingEnabled must be true or false." });
    return;
  }
  try {
    const now = new Date();
    const [row] = await db
      .insert(recordingConsentTable)
      .values({ clerkUserId: userId, consentedAt: now, trainingEnabled })
      .onConflictDoUpdate({
        target: recordingConsentTable.clerkUserId,
        set: { consentedAt: now, trainingEnabled, updatedAt: now },
      })
      .returning();
    res.json(toConsentView(row));
  } catch (err) {
    logger.error({ err }, "Failed to save recording consent");
    res.status(500).json({ error: "Couldn't save your choice. Try again." });
  }
});

/**
 * PUT /recording/training { trainingEnabled }: the toggle in Settings > Privacy.
 * Doesn't count as consent to record.
 */
router.put("/recording/training", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const trainingEnabled = readTraining(req.body);
  if (trainingEnabled === null) {
    res.status(400).json({ error: "trainingEnabled must be true or false." });
    return;
  }
  try {
    const [row] = await db
      .insert(recordingConsentTable)
      .values({ clerkUserId: userId, trainingEnabled })
      .onConflictDoUpdate({
        target: recordingConsentTable.clerkUserId,
        set: { trainingEnabled, updatedAt: new Date() },
      })
      .returning();
    res.json(toConsentView(row));
  } catch (err) {
    logger.error({ err }, "Failed to save the training setting");
    res.status(500).json({ error: "Couldn't save your choice. Try again." });
  }
});

export default router;
