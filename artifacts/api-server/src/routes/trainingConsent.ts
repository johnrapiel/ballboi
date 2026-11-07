import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, recordingConsentTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { BETA_RELEASE_URL, readBetaRelease, releaseNeeded, type BetaReleaseSetting } from "../lib/betaRelease";

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
  /**
   * The Beta Footage Release (B9). `needed`: show the release checkbox, unchecked,
   * before the next recording. Off entirely unless the server setting is on.
   */
  release: {
    required: boolean;
    version: number;
    url: string;
    agreedVersion: number | null;
    agreedAt: string | null;
    needed: boolean;
  };
}

type ConsentRow = {
  consentedAt: Date | null;
  trainingEnabled: boolean;
  releaseVersion?: number | null;
  releaseAgreedAt?: Date | null;
};

export function toConsentView(row: ConsentRow | undefined, setting: BetaReleaseSetting = readBetaRelease()): ConsentView {
  const agreedVersion = row?.releaseVersion ?? null;
  return {
    consented: !!row?.consentedAt,
    consentedAt: row?.consentedAt ? row.consentedAt.toISOString() : null,
    trainingEnabled: row ? row.trainingEnabled : true,
    release: {
      required: setting.required,
      version: setting.version,
      url: BETA_RELEASE_URL,
      agreedVersion,
      agreedAt: row?.releaseAgreedAt ? row.releaseAgreedAt.toISOString() : null,
      needed: releaseNeeded(setting, agreedVersion),
    },
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

/** The release version the app says the person agreed to, or null. */
function readReleaseVersion(body: unknown): number | null {
  const v = (body as { releaseVersion?: unknown } | null)?.releaseVersion;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * POST /recording/consent { trainingEnabled, releaseVersion? }: agreed on the
 * first-recording carousel's "Your choices" page. While the beta release is
 * required and this account hasn't agreed to the current version, the request
 * must carry that version (the checked box), or it's refused.
 */
router.post("/recording/consent", requireAuth, async (req: Request, res: Response) => {
  const userId = getAuth(req).userId!;
  const trainingEnabled = readTraining(req.body);
  if (trainingEnabled === null) {
    res.status(400).json({ error: "trainingEnabled must be true or false." });
    return;
  }
  const setting = readBetaRelease();
  const sentVersion = readReleaseVersion(req.body);
  const agreesNow = setting.required && sentVersion === setting.version;
  try {
    if (setting.required && !agreesNow) {
      const [existing] = await db
        .select()
        .from(recordingConsentTable)
        .where(eq(recordingConsentTable.clerkUserId, userId));
      if (releaseNeeded(setting, existing?.releaseVersion)) {
        res.status(400).json({ error: "Agree to the Ball Boi Beta Footage Release to continue." });
        return;
      }
    }
    const now = new Date();
    const release = agreesNow ? { releaseVersion: setting.version, releaseAgreedAt: now } : {};
    const [row] = await db
      .insert(recordingConsentTable)
      .values({ clerkUserId: userId, consentedAt: now, trainingEnabled, ...release })
      .onConflictDoUpdate({
        target: recordingConsentTable.clerkUserId,
        set: { consentedAt: now, trainingEnabled, updatedAt: now, ...release },
      })
      .returning();
    res.json(toConsentView(row, setting));
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
