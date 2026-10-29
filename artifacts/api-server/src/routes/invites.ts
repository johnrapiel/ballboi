import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { leagueInvitesTable, leaguesTable, playersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Create invite for a league
router.post("/leagues/:leagueId/invites", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

  const { userId } = getAuth(req);
  const { maxUses, expiresAt } = req.body;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (league.createdByClerkUserId !== userId) {
    return res.status(403).json({ error: "Only the league creator can manage invites" });
  }

  const code = nanoid(10);

  const [invite] = await db
    .insert(leagueInvitesTable)
    .values({
      code,
      leagueId,
      createdByClerkUserId: userId!,
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ?? null,
      isActive: true,
    })
    .returning();

  return res.status(201).json({
    ...invite,
    leagueName: league.name,
  });
});

// Get all invites for a league
router.get("/leagues/:leagueId/invites", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) return res.status(400).json({ error: "Invalid league ID" });

  const { userId } = getAuth(req);
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (league.createdByClerkUserId !== userId) {
    return res.status(403).json({ error: "Only the league creator can manage invites" });
  }

  const invites = await db
    .select()
    .from(leagueInvitesTable)
    .where(and(eq(leagueInvitesTable.leagueId, leagueId), eq(leagueInvitesTable.isActive, true)));

  return res.json(invites);
});

// Get invite info by code (public)
router.get("/invites/:code", async (req, res) => {
  const { code } = req.params;
  const [invite] = await db.select().from(leagueInvitesTable).where(eq(leagueInvitesTable.code, code));
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  if (!invite.isActive) return res.status(410).json({ error: "Invite is no longer active" });

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, invite.leagueId));
  const playerCount = await db.select().from(playersTable).where(eq(playersTable.leagueId, invite.leagueId));

  return res.json({
    ...invite,
    leagueName: league?.name ?? "Unknown",
    leagueSport: null, // leagues have no sport column; kept for the API contract
    playerCount: playerCount.length,
  });
});

// Accept invite / join league
router.post("/invites/:code/join", requireAuth, async (req, res) => {
  const { code } = req.params;
  const { userId } = getAuth(req);
  const { playerName, skillLevel } = req.body;
  const allowedSkillLevels = new Set(["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"]);
  const nextSkillLevel = allowedSkillLevels.has(skillLevel) ? skillLevel : "3.0";

  if (!playerName?.trim()) return res.status(400).json({ error: "playerName is required" });

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${code}), 0)`);

      const [invite] = await tx.select().from(leagueInvitesTable).where(eq(leagueInvitesTable.code, code));
      if (!invite) return { status: 404, payload: { error: "Invite not found" } };
      if (!invite.isActive) return { status: 410, payload: { error: "Invite is no longer active" } };
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        return { status: 410, payload: { error: "Invite has expired" } };
      }
      if (invite.maxUses && invite.usageCount >= invite.maxUses) {
        return { status: 410, payload: { error: "Invite has reached maximum uses" } };
      }

      const [league] = await tx.select().from(leaguesTable).where(eq(leaguesTable.id, invite.leagueId));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${String(invite.leagueId)}), hashtext(${userId!}))`);

      const [existing] = await tx
        .select()
        .from(playersTable)
        .where(and(eq(playersTable.leagueId, invite.leagueId), eq(playersTable.clerkUserId, userId!)));

      if (existing) {
        return {
          status: 200,
          payload: {
            player: existing,
            league: { id: league?.id, name: league?.name },
            message: "Already a member of this league",
          },
        };
      }

      const [player] = await tx
        .insert(playersTable)
        .values({
          name: playerName.trim(),
          clerkUserId: userId!,
          leagueId: invite.leagueId,
          skillLevel: nextSkillLevel,
          wins: 0,
          losses: 0,
        })
        .returning();

      await tx
        .update(leagueInvitesTable)
        .set({ usageCount: invite.usageCount + 1 })
        .where(eq(leagueInvitesTable.id, invite.id));

      return {
        status: 201,
        payload: {
          player,
          league: { id: league?.id, name: league?.name },
          message: "Successfully joined league",
        },
      };
    });

    return res.status(result.status).json(result.payload);
  } catch (err) {
    console.error("join invite error:", err);
    return res.status(500).json({ error: "Failed to join league" });
  }
});

// Deactivate invite
router.delete("/invites/:code", requireAuth, async (req, res) => {
  const { code } = req.params;
  const { userId } = getAuth(req);

  const [invite] = await db.select().from(leagueInvitesTable).where(eq(leagueInvitesTable.code, code));
  if (!invite) return res.status(404).json({ error: "Invite not found" });

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, invite.leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (league.createdByClerkUserId !== userId) {
    return res.status(403).json({ error: "Only the league creator can manage invites" });
  }

  await db.update(leagueInvitesTable).set({ isActive: false }).where(eq(leagueInvitesTable.code, code));
  return res.status(204).send();
});

export default router;
