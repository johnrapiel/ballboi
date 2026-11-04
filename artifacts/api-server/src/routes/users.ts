import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { autoLinkPlayersForUser } from "../lib/autoLinkPlayer.js";
import { deleteOldPhoto, newPhotoProblem } from "../lib/profilePhoto.js";
import { deleteAccount } from "../lib/accountDeletion.js";
import { isUserIntent, parseHomeArea, parseIntents } from "../lib/onboarding.js";
import { syncProfileName } from "../lib/playerProfile.js";

const logger = pino({ name: "users" });

const router = Router();

/**
 * A1, S6: a name change shows in every league right away. Rosters, pairings
 * and Manage read the profile; this also updates the copy on league rows that
 * standings, scores and notifications read. A failure never fails the save.
 */
async function syncNameToLeagues(clerkUserId: string, displayName: string) {
  await syncProfileName(clerkUserId, displayName).catch((err) => logger.error({ err }, "Couldn't copy the profile name to leagues"));
}

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

router.get("/users/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId!));
  if (!user) return res.status(404).json({ error: "User profile not found" });
  return res.json(user);
});

router.post("/users/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const { displayName, email, phone, avatarUrl, skillLevel, dominantHand, bio, onboardingComplete } = req.body;

  if (!displayName) return res.status(400).json({ error: "displayName is required" });

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId!));
  if (avatarUrl !== undefined) {
    const problem = await newPhotoProblem(avatarUrl, existing?.avatarUrl, userId!);
    if (problem) return res.status(400).json({ error: problem });
  }

  if (existing) {
    const previousName = existing.displayName;
    const [updated] = await db
      .update(usersTable)
      .set({
        displayName,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        avatarUrl: avatarUrl ?? existing.avatarUrl,
        skillLevel: skillLevel ?? existing.skillLevel,
        dominantHand: dominantHand ?? existing.dominantHand,
        bio: bio ?? existing.bio,
        onboardingComplete: onboardingComplete !== undefined ? onboardingComplete : existing.onboardingComplete,
      })
      .where(eq(usersTable.clerkUserId, userId!))
      .returning();
    await deleteOldPhoto(existing.avatarUrl, updated.avatarUrl, logger);
    if (updated.displayName !== previousName) await syncNameToLeagues(userId!, updated.displayName);
    return res.json(updated);
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      clerkUserId: userId!,
      displayName,
      email,
      phone,
      avatarUrl,
      skillLevel: skillLevel ?? "intermediate",
      dominantHand: dominantHand ?? "right",
      bio,
      onboardingComplete: onboardingComplete ?? false,
    })
    .returning();
  // A2: runs once, when the profile is made, on the verified email from Clerk.
  await autoLinkPlayersForUser(userId!)
    .catch((err) => logger.error({ err }, "Auto-link failed on user create"));
  await syncNameToLeagues(userId!, created.displayName);
  return res.status(201).json(created);
});

router.put("/users/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const { displayName, email, phone, avatarUrl, skillLevel, dominantHand, bio, onboardingComplete } = req.body;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId!));
  if (!existing) return res.status(404).json({ error: "User profile not found" });
  if (avatarUrl !== undefined) {
    const problem = await newPhotoProblem(avatarUrl, existing.avatarUrl, userId!);
    if (problem) return res.status(400).json({ error: problem });
  }

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
  if (skillLevel !== undefined) updateData.skillLevel = skillLevel;
  if (dominantHand !== undefined) updateData.dominantHand = dominantHand;
  if (bio !== undefined) updateData.bio = bio;
  if (onboardingComplete !== undefined) updateData.onboardingComplete = onboardingComplete;

  if (Object.keys(updateData).length === 0) return res.json(existing);
  const previousName = existing.displayName;
  const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.clerkUserId, userId!)).returning();
  await deleteOldPhoto(existing.avatarUrl, updated.avatarUrl, logger);
  if (updated.displayName !== previousName) await syncNameToLeagues(userId!, updated.displayName);
  return res.json(updated);
});

/**
 * PUT /users/me/home-area { zip, latitude?, longitude? }
 * Onboarding step 4. The zip is required; coordinates only come from the
 * optional "Use my location" shortcut and are stored rounded (approximate).
 */
router.put("/users/me/home-area", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const parsed = parseHomeArea(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const [updated] = await db
    .update(usersTable)
    .set({ homeZip: parsed.zip, homeLatitude: parsed.latitude, homeLongitude: parsed.longitude })
    .where(eq(usersTable.clerkUserId, userId!))
    .returning();
  if (!updated) return res.status(404).json({ error: "User profile not found" });
  return res.json(updated);
});

/**
 * PUT /users/me/intents { intents: [] }
 * Onboarding step 4, "What do you want to do on Ball Boi?": zero or more picks.
 * Skip sends an empty list. The last step, so it also marks onboarding
 * complete. Research data only; nothing in the app reads it back.
 */
router.put("/users/me/intents", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const intents = parseIntents(req.body);
  if ("error" in intents) return res.status(400).json({ error: intents.error });
  const [updated] = await db
    .update(usersTable)
    .set({ intents, onboardingComplete: true })
    .where(eq(usersTable.clerkUserId, userId!))
    .returning();
  if (!updated) return res.status(404).json({ error: "User profile not found" });
  return res.json(updated);
});

/**
 * PUT /users/me/intent { intent }
 * The single-choice version of onboarding step 4. Kept so an older app build
 * still finishes onboarding; it also records the answer in `intents`.
 */
router.put("/users/me/intent", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const intent = req.body?.intent;
  if (!isUserIntent(intent)) return res.status(400).json({ error: "Pick one of the options." });
  const [updated] = await db
    .update(usersTable)
    .set({ intent, intents: [intent], onboardingComplete: true })
    .where(eq(usersTable.clerkUserId, userId!))
    .returning();
  if (!updated) return res.status(404).json({ error: "User profile not found" });
  return res.json(updated);
});

/**
 * DELETE /users/me
 * Permanently deletes the signed-in person's account and personal data
 * (App Store guideline 5.1.1(v)). The body must be { "confirm": "DELETE" }
 * so a stray request can't wipe an account.
 */
router.delete("/users/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  if (req.body?.confirm !== "DELETE") {
    return res.status(400).json({ error: 'Send { "confirm": "DELETE" } to delete your account.' });
  }
  try {
    const summary = await deleteAccount(userId!, logger);
    return res.json({ deleted: true, ...summary });
  } catch (err) {
    logger.error({ err, userId }, "Account deletion failed");
    return res.status(500).json({ error: "We couldn't delete your account. Try again, or email support@ballboi.tennis." });
  }
});

export { requireAuth };
export default router;
