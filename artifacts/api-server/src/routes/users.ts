import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { autoLinkPlayersForUser } from "../lib/autoLinkPlayer.js";
import { deleteAccount } from "../lib/accountDeletion.js";

const logger = pino({ name: "users" });

const router = Router();

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

  if (existing) {
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
    await autoLinkPlayersForUser({ clerkUserId: userId!, displayName, email: email ?? existing.email })
      .catch((err) => logger.error({ err }, "Auto-link failed on user update"));
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
  await autoLinkPlayersForUser({ clerkUserId: userId!, displayName, email })
    .catch((err) => logger.error({ err }, "Auto-link failed on user create"));
  return res.status(201).json(created);
});

router.put("/users/me", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const { displayName, email, phone, avatarUrl, skillLevel, dominantHand, bio, onboardingComplete } = req.body;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, userId!));
  if (!existing) return res.status(404).json({ error: "User profile not found" });

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (email !== undefined) updateData.email = email;
  if (phone !== undefined) updateData.phone = phone;
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
  if (skillLevel !== undefined) updateData.skillLevel = skillLevel;
  if (dominantHand !== undefined) updateData.dominantHand = dominantHand;
  if (bio !== undefined) updateData.bio = bio;
  if (onboardingComplete !== undefined) updateData.onboardingComplete = onboardingComplete;

  const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.clerkUserId, userId!)).returning();
  await autoLinkPlayersForUser({
    clerkUserId: userId!,
    displayName: updated.displayName,
    email: updated.email,
  }).catch((err) => logger.error({ err }, "Auto-link failed on user PUT update"));
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
    return res.status(500).json({ error: "We couldn't delete your account. Try again, or email support." });
  }
});

export { requireAuth };
export default router;
