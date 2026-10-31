import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { leagueInvitesTable, leaguesTable, playersTable, leagueJoinRequestsTable } from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { isLeagueAdmin } from "../lib/leagueAccess.js";
import { leagueToday } from "../lib/leagueCalendar.js";
import { joinOutcome } from "../lib/leagueJoining.js";

const router = Router();

// Codes are typed by hand, so they're uppercase with no look-alike characters
// (no 0/O, 1/I/L). Older codes were mixed case, so lookups ignore case.
const newInviteCode = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);

function sameCode(code: string) {
  return sql`upper(${leagueInvitesTable.code}) = ${code.trim().toUpperCase()}`;
}

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
  if (!(await isLeagueAdmin(league.id, userId!))) {
    return res.status(403).json({ error: "Only this league's admins can manage invites" });
  }

  const code = newInviteCode();

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
  if (!(await isLeagueAdmin(league.id, userId!))) {
    return res.status(403).json({ error: "Only this league's admins can manage invites" });
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
  const [invite] = await db.select().from(leagueInvitesTable).where(sameCode(code));
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  if (!invite.isActive) return res.status(410).json({ error: "Invite is no longer active" });

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, invite.leagueId));
  const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, invite.leagueId));
  const activeCount = players.filter((p) => !p.leftAt).length;
  // Tells the join screen up front whether joining now means the waitlist.
  const outcome = league
    ? joinOutcome({ league, activePlayerCount: activeCount, today: leagueToday(), via: "invite" })
    : null;

  return res.json({
    ...invite,
    leagueName: league?.name ?? "Unknown",
    leagueSport: null, // leagues have no sport column; kept for the API contract
    playerCount: activeCount,
    waitlistOnly: outcome?.kind === "waitlist",
    waitlistReason: outcome?.kind === "waitlist" ? outcome.reason : null,
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
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${code.trim().toUpperCase()}), 0)`);

      const [invite] = await tx.select().from(leagueInvitesTable).where(sameCode(code));
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

      if (existing && !existing.leftAt) {
        return {
          status: 200,
          payload: {
            player: existing,
            league: { id: league?.id, name: league?.name },
            message: "Already a member of this league",
          },
        };
      }
      if (!league) return { status: 404, payload: { error: "League not found" } };

      // Every league locks to new joins once its season starts, and a full
      // league can't take more players. Both go to the waitlist (decision 26).
      const active = await tx
        .select({ id: playersTable.id })
        .from(playersTable)
        .where(and(eq(playersTable.leagueId, invite.leagueId), isNull(playersTable.leftAt)));
      const outcome = joinOutcome({ league, activePlayerCount: active.length, today: leagueToday(), via: "invite" });
      if (outcome.kind === "waitlist") {
        await tx
          .insert(leagueJoinRequestsTable)
          .values({
            leagueId: invite.leagueId,
            clerkUserId: userId!,
            playerName: playerName.trim(),
            skillLevel: nextSkillLevel,
            kind: "waitlist",
          })
          .onConflictDoNothing();
        return {
          status: 202,
          payload: { waitlisted: true, league: { id: league.id, name: league.name }, message: outcome.reason },
        };
      }

      // Someone who left before the season started can rejoin.
      if (existing) {
        const [player] = await tx
          .update(playersTable)
          .set({ leftAt: null, name: playerName.trim() })
          .where(eq(playersTable.id, existing.id))
          .returning();
        return {
          status: 200,
          payload: { player, league: { id: league.id, name: league.name }, message: "Welcome back to the league" },
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

  const [invite] = await db.select().from(leagueInvitesTable).where(sameCode(code));
  if (!invite) return res.status(404).json({ error: "Invite not found" });

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, invite.leagueId));
  if (!league) return res.status(404).json({ error: "League not found" });
  if (!(await isLeagueAdmin(league.id, userId!))) {
    return res.status(403).json({ error: "Only this league's admins can manage invites" });
  }

  await db.update(leagueInvitesTable).set({ isActive: false }).where(eq(leagueInvitesTable.id, invite.id));
  return res.status(204).send();
});

export default router;
