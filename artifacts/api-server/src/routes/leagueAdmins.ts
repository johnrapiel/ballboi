import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, leagueAdminsTable, leaguesTable, playersTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getLeagueRole } from "../lib/leagueAccess.js";
import { promoteProblem, removeAdminProblem, type LeagueRole } from "../lib/leagueRoles.js";
import { requireLeagueAdmin } from "../middlewares/requireLeagueAdmin.js";

// Co-admins and the viewer's own role in a league (spec: Roles and onboarding).

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

const router = Router();

/** The signed-in user's place in a league: admin role and player row, if any. */
router.get("/leagues/:leagueId/membership", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }

  const [league] = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const [role, [player]] = await Promise.all([
    getLeagueRole(leagueId, userId!),
    db
      .select({ id: playersTable.id, leftAt: playersTable.leftAt })
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, userId!))),
  ]);

  res.json({
    leagueId,
    role,
    isAdmin: role !== null,
    playerId: player && !player.leftAt ? player.id : null,
    isPlaying: !!player && !player.leftAt,
    hasLeft: !!player?.leftAt,
  });
});

/** Everyone who runs the league, owner first. */
router.get("/leagues/:leagueId/admins", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }

  const admins = await db.select().from(leagueAdminsTable).where(eq(leagueAdminsTable.leagueId, leagueId));
  const ids = admins.map((a) => a.clerkUserId);
  const [players, users] = ids.length
    ? await Promise.all([
        db
          .select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId })
          .from(playersTable)
          .where(and(eq(playersTable.leagueId, leagueId), inArray(playersTable.clerkUserId, ids))),
        db
          .select({ clerkUserId: usersTable.clerkUserId, displayName: usersTable.displayName })
          .from(usersTable)
          .where(inArray(usersTable.clerkUserId, ids)),
      ])
    : [[], []];

  const rows = admins.map((a) => {
    const player = players.find((p) => p.clerkUserId === a.clerkUserId);
    const user = users.find((u) => u.clerkUserId === a.clerkUserId);
    return {
      clerkUserId: a.clerkUserId,
      role: a.role,
      playerId: player?.id ?? null,
      name: player?.name ?? user?.displayName ?? "League admin",
    };
  });
  rows.sort((x, y) => (x.role === y.role ? x.name.localeCompare(y.name) : x.role === "owner" ? -1 : 1));
  res.json(rows);
});

/** Admins: everyone playing this season, with their role, for Manage. */
router.get("/leagues/:leagueId/roster", requireLeagueAdmin, async (_req, res) => {
  const leagueId = res.locals.leagueId as number;
  const [players, admins] = await Promise.all([
    db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)))
      .orderBy(asc(playersTable.name)),
    db.select().from(leagueAdminsTable).where(eq(leagueAdminsTable.leagueId, leagueId)),
  ]);
  res.json(
    players.map((p) => ({
      playerId: p.id,
      name: p.name,
      skillLevel: p.skillLevel,
      hasAccount: !!p.clerkUserId,
      role: admins.find((a) => p.clerkUserId && a.clerkUserId === p.clerkUserId)?.role ?? null,
    })),
  );
});

/** Promote a member to co-admin. Any admin can do this. */
router.post("/leagues/:leagueId/admins", requireLeagueAdmin, async (req, res) => {
  const leagueId = res.locals.leagueId as number;
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) { res.status(400).json({ error: "playerId is required" }); return; }

  const [member] = await db
    .select({ clerkUserId: playersTable.clerkUserId, leftAt: playersTable.leftAt, name: playersTable.name })
    .from(playersTable)
    .where(and(eq(playersTable.id, playerId), eq(playersTable.leagueId, leagueId)));
  const existingRole = member?.clerkUserId ? await getLeagueRole(leagueId, member.clerkUserId) : null;
  const problem = promoteProblem({ member, existingRole });
  if (problem) { res.status(400).json({ error: problem }); return; }

  await db
    .insert(leagueAdminsTable)
    .values({ leagueId, clerkUserId: member!.clerkUserId!, role: "co_admin" })
    .onConflictDoNothing();

  res.status(201).json({ clerkUserId: member!.clerkUserId, role: "co_admin", playerId, name: member!.name });
});

/** Remove a co-admin. The owner can remove anyone else; a co-admin can step down. */
router.delete("/leagues/:leagueId/admins/:clerkUserId", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }
  const targetUserId = String(req.params.clerkUserId);

  const actorRole = await getLeagueRole(leagueId, userId!);
  if (!actorRole) { res.status(403).json({ error: "Only this league's admins can do that" }); return; }
  const targetRole: LeagueRole | null = await getLeagueRole(leagueId, targetUserId);

  const problem = removeAdminProblem({ actorUserId: userId!, actorRole, targetUserId, targetRole });
  if (problem) { res.status(targetRole ? 403 : 404).json({ error: problem }); return; }

  await db
    .delete(leagueAdminsTable)
    .where(and(eq(leagueAdminsTable.leagueId, leagueId), eq(leagueAdminsTable.clerkUserId, targetUserId)));
  res.status(204).send();
});

export default router;
