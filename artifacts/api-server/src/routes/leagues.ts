import { Router, Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { leaguesTable, playersTable, matchesTable, leagueRoundsTable, leagueAdminsTable } from "@workspace/db";
import { CreateLeagueBody, UpdateLeagueBody } from "@workspace/api-zod";
import { and, eq, count, isNull } from "drizzle-orm";
import { autoLinkPlayer } from "../lib/autoLinkPlayer.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { adminLeagueIds, canViewLeague, isLeagueAdmin, memberLeagueIds, PRIVATE_LEAGUE } from "../lib/leagueAccess.js";
import { runLeagueDay } from "../services/leagueRounds.js";
import { logger } from "../lib/logger.js";
import { leagueChat } from "../messaging/leagueChatEvents.js";
import { getPastSeasonNames } from "../services/seasonService.js";
import { computeStandings, computeTeamStandings } from "../lib/leagueStandings.js";
import { isFixedDoubles } from "../lib/doublesTeams.js";
import { standingTeams } from "../services/doublesRounds.js";
import { SKILL_LEVELS, checkStartDate, seasonDates, validateLeagueSetup } from "../lib/leagueSetup.js";
import { loadProfiles, playerDisplayName, playerLevelText } from "../lib/playerProfile.js";
import { DEFAULT_LEAGUE_TIME_ZONE, isTimeZone } from "../lib/leagueCalendar.js";
import { checkLeagueMatchTime } from "../lib/matchTimes.js";
import { AREA_MISSING, NAME_MISSING, areaColumns, areaForPlace, withoutAreaColumns } from "../lib/leagueArea.js";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

const router = Router();

// Signed in only. Lists the caller's own leagues (started, admin of, or a
// player in). Without `clerkUserId`, Open leagues are listed too; Private
// leagues never show to people outside them.
router.get("/leagues", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  const asked = req.query.clerkUserId;
  if (asked !== undefined && asked !== userId) {
    res.status(403).json({ error: "You can only list your own leagues." });
    return;
  }
  const mineOnly = asked !== undefined;
  const [all, mine, myRows, adminOf] = await Promise.all([
    db.select().from(leaguesTable).orderBy(leaguesTable.createdAt),
    memberLeagueIds(userId!),
    db.select({ leagueId: playersTable.leagueId, leftAt: playersTable.leftAt }).from(playersTable).where(eq(playersTable.clerkUserId, userId!)),
    adminLeagueIds(userId!),
  ]);
  // C5: a player who left (and doesn't run it) sees the league under Past.
  const youLeft = (leagueId: number) => {
    const rows = myRows.filter((r) => r.leagueId === leagueId);
    return rows.length > 0 && rows.every((r) => r.leftAt) && !adminOf.includes(leagueId);
  };
  const leagues = all.filter(
    (l) => mine.includes(l.id) || l.createdByClerkUserId === userId || (!mineOnly && l.visibility === "open"),
  );

  const [playerCounts, matchCounts] = await Promise.all([
    db
      .select({ leagueId: playersTable.leagueId, count: count() })
      .from(playersTable)
      .where(isNull(playersTable.leftAt))
      .groupBy(playersTable.leagueId),
    db
      .select({ leagueId: matchesTable.leagueId, count: count() })
      .from(matchesTable)
      .groupBy(matchesTable.leagueId),
  ]);

  const pcMap: Record<number, number> = {};
  for (const pc of playerCounts) {
    if (pc.leagueId !== null) pcMap[pc.leagueId] = Number(pc.count);
  }
  const mcMap: Record<number, number> = {};
  for (const mc of matchCounts) {
    if (mc.leagueId !== null) mcMap[mc.leagueId] = Number(mc.count);
  }

  { res.json(
    leagues.map((l) => ({
      ...withoutAreaColumns(l),
      startDate: l.startDate ?? null,
      endDate: l.endDate ?? null,
      location: l.location ?? null,
      description: l.description ?? null,
      leagueType: l.leagueType ?? "singles",
      createdByClerkUserId: l.createdByClerkUserId ?? null,
      playerCount: pcMap[l.id] ?? 0,
      matchCount: mcMap[l.id] ?? 0,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
      endedAt: l.endedAt ? l.endedAt.toISOString() : null,
      youLeft: youLeft(l.id),
    }))
  ); return; }
});

// Start a league (spec: Leagues > Setup). Anyone signed in can start one and is
// its admin. With `playing` (the default), the admin also joins as a player.
router.post("/leagues", requireAuth, async (req, res) => {
  const { userId } = getAuth(req);
  // Decision 182: a new league needs a name and an area, with a plain error.
  const raw = (req.body ?? {}) as { name?: unknown; area?: unknown };
  if (typeof raw.name !== "string" || !raw.name.trim()) { res.status(400).json({ error: NAME_MISSING }); return; }
  if (typeof raw.area !== "string" || !raw.area.trim()) { res.status(400).json({ error: AREA_MISSING }); return; }
  const place = areaForPlace(raw.area);
  if (!place.ok) { res.status(400).json({ error: place.error }); return; }
  const parsed = CreateLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    { res.status(400).json({ error: parsed.error.message }); return; }
  }
  const body = parsed.data;
  const problem = validateLeagueSetup(body);
  if (problem) { res.status(400).json({ error: problem }); return; }
  // A weekly match day and time for clubs, or neither so players pick (PR 4).
  const matchTime = checkLeagueMatchTime(body);
  if (!matchTime.ok) { res.status(400).json({ error: matchTime.error }); return; }
  // The league runs on its creator's time zone, sent by their phone.
  const timeZone = isTimeZone(body.timeZone) ? body.timeZone : DEFAULT_LEAGUE_TIME_ZONE;
  const tooSoon = checkStartDate(body.startDate, timeZone);
  if (tooSoon) { res.status(400).json({ error: tooSoon }); return; }

  const playing = body.playing !== false;
  const { endDate, status } = seasonDates(body.startDate, body.seasonWeeks);
  const doubles = body.leagueType === "doubles";
  const open = body.visibility === "open";
  const sentLevel = (SKILL_LEVELS as readonly string[]).includes(body.skillLevel ?? "") ? body.skillLevel! : "3.0";
  // A1: the creator's league row starts from their profile name and level.
  const profiles = playing ? await loadProfiles([userId]) : new Map();
  const playerName = profiles.get(userId!)?.displayName?.trim() || body.playerName?.trim() || "";
  const skillLevel = playerLevelText({ clerkUserId: userId, skillLevel: sentLevel }, profiles);

  const { league, playerCount } = await db.transaction(async (tx) => {
    const [league] = await tx
      .insert(leaguesTable)
      .values({
        name: body.name.trim(),
        description: body.description ?? undefined,
        format: body.format,
        status,
        leagueType: doubles ? "doubles" : "singles",
        partnerMode: doubles ? body.partnerMode ?? undefined : undefined,
        visibility: open ? "open" : "private",
        minRating: open ? body.minRating ?? undefined : undefined,
        maxRating: open ? body.maxRating ?? undefined : undefined,
        rosterCap: body.rosterCap ?? undefined,
        startDate: body.startDate,
        endDate,
        seasonWeeks: body.seasonWeeks,
        playoffSize: body.playoffSize ?? 0,
        // Unplayed matches follow the fixed 1-week grace period (decision 25); the
        // old per-league rule is no longer set.
        location: body.location?.trim() || undefined,
        ...areaColumns(place.area),
        timeZone,
        matchDay: matchTime.matchDay,
        matchTime: matchTime.matchTime,
        createdByClerkUserId: userId!,
      })
      .returning();

    // The creator owns the league and can promote co-admins (spec: Roles).
    await tx.insert(leagueAdminsTable).values({ leagueId: league.id, clerkUserId: userId!, role: "owner" });

    if (playing) {
      await tx.insert(playersTable).values({
        name: playerName,
        clerkUserId: userId!,
        leagueId: league.id,
        skillLevel,
        wins: 0,
        losses: 0,
      });
    }
    return { league, playerCount: playing ? 1 : 0 };
  });

  // Its chat in Messages, with the creator in it (decision 145).
  leagueChat.leagueChanged(league.id);

  // A season starting tomorrow gets its first round drafted right away.
  runLeagueDay(league).catch((err) => logger.error({ err, leagueId: league.id }, "First league day failed"));

  { res.status(201).json({
    ...withoutAreaColumns(league),
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    createdByClerkUserId: league.createdByClerkUserId ?? null,
    playerCount,
    matchCount: 0,
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
    endedAt: league.endedAt ? league.endedAt.toISOString() : null,
  }); return; }
});

router.get("/leagues/:leagueId", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!(await canViewLeague(league, getAuth(req).userId!))) { res.status(403).json({ error: PRIVATE_LEAGUE }); return; }

  const [pc] = await db.select({ count: count() }).from(playersTable).where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
  const [mc] = await db.select({ count: count() }).from(matchesTable).where(eq(matchesTable.leagueId, leagueId));

  { res.json({
    ...withoutAreaColumns(league),
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    playerCount: Number(pc?.count ?? 0),
    matchCount: Number(mc?.count ?? 0),
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
    endedAt: league.endedAt ? league.endedAt.toISOString() : null,
  }); return; }
});

router.patch("/leagues/:leagueId", requireAdmin, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if ("leagueType" in req.body) {
    { res.status(400).json({ error: "leagueType cannot be changed after a league is created" }); return; }
  }
  const parsed = UpdateLeagueBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: Partial<typeof leaguesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined && parsed.data.name !== null) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? undefined;
  if (parsed.data.format !== undefined && parsed.data.format !== null) updates.format = parsed.data.format;
  if (parsed.data.status !== undefined && parsed.data.status !== null) updates.status = parsed.data.status;
  if (parsed.data.startDate !== undefined) updates.startDate = parsed.data.startDate ?? undefined;
  if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate ?? undefined;
  if (parsed.data.location !== undefined) updates.location = parsed.data.location ?? undefined;

  const [league] = await db.update(leaguesTable).set(updates).where(eq(leaguesTable.id, leagueId)).returning();
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  // The chat's title is the league name.
  leagueChat.leagueChanged(leagueId);

  const [pc] = await db.select({ count: count() }).from(playersTable).where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
  const [mc] = await db.select({ count: count() }).from(matchesTable).where(eq(matchesTable.leagueId, leagueId));

  { res.json({
    ...withoutAreaColumns(league),
    startDate: league.startDate ?? null,
    endDate: league.endDate ?? null,
    location: league.location ?? null,
    description: league.description ?? null,
    leagueType: league.leagueType ?? "singles",
    playerCount: Number(pc?.count ?? 0),
    matchCount: Number(mc?.count ?? 0),
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
    endedAt: league.endedAt ? league.endedAt.toISOString() : null,
  }); return; }
});

// Deleting a league is for its own admins now (C10): routes/leagueLifecycle.ts.

router.post("/leagues/:leagueId/reset", requireAdmin, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [league] = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const deletedRounds = await db
    .delete(leagueRoundsTable)
    .where(eq(leagueRoundsTable.leagueId, leagueId))
    .returning({ id: leagueRoundsTable.id });

  { res.json({ deleted: { rounds: deletedRounds.length } }); return; }
});

// Standings rank on wins only; grace-week, voided, and playoff matches don't
// count; players who left are removed (spec: Leagues > Scores and standings).
router.get("/leagues/:leagueId/standings", requireAuth, async (req, res) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [league] = await db
    .select({
      id: leaguesTable.id,
      visibility: leaguesTable.visibility,
      createdByClerkUserId: leaguesTable.createdByClerkUserId,
      leagueType: leaguesTable.leagueType,
      partnerMode: leaguesTable.partnerMode,
    })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!(await canViewLeague(league, getAuth(req).userId!))) { res.status(403).json({ error: PRIVATE_LEAGUE }); return; }

  const seasonFilter = typeof req.query.season === "string" ? req.query.season : undefined;
  const pastSeasonNames = seasonFilter ? [] : await getPastSeasonNames(leagueId);

  const [players, matches] = await Promise.all([
    db.select().from(playersTable).where(eq(playersTable.leagueId, leagueId)),
    db.select().from(matchesTable).where(eq(matchesTable.leagueId, leagueId)),
  ]);

  const includeSeason = (season: string | null) => {
    if (seasonFilter === "all") return true;
    if (seasonFilter) return season === seasonFilter;
    return season === null || !pastSeasonNames.includes(season);
  };

  // D3: fixed-partner doubles ranks teams ("John Rapiel & Sam Lee"); rotating ranks players.
  if (isFixedDoubles(league)) {
    const teams = await standingTeams(leagueId);
    const profiles = await loadProfiles(players.map((p) => p.clerkUserId));
    const names = new Map(players.map((p) => [p.id, playerDisplayName(p, profiles)]));
    res.json(computeTeamStandings(teams, names, matches, includeSeason));
    return;
  }
  { res.json(computeStandings(players, matches, includeSeason)); return; }
});

router.post("/leagues/:leagueId/players", requireAuth, async (req: Request, res: Response) => {
  const leagueId = parseInt(String(req.params.leagueId));
  if (isNaN(leagueId)) { res.status(400).json({ error: "Invalid league ID" }); return; }

  const { userId } = getAuth(req);
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!(await isLeagueAdmin(leagueId, userId!))) {
    { res.status(403).json({ error: "Only this league's admins can add players directly" }); return; }
  }

  const { name, email, phone, skillLevel, dominantHand, bio } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const allowedSkillLevels = new Set(["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"]);

  const [inserted] = await db
    .insert(playersTable)
    .values({
      name: name.trim(),
      email: email ?? null,
      phone: phone ?? null,
      bio: bio ?? null,
      skillLevel: allowedSkillLevels.has(skillLevel) ? skillLevel : "3.0",
      dominantHand: dominantHand ?? "right",
      leagueId,
    })
    .returning();

  const linked = await autoLinkPlayer(inserted);
  if (linked) leagueChat.leagueChanged(leagueId);

  const { clerkUserId: _omit, ...publicPlayer } = {
    ...inserted,
    clerkUserId: linked ?? inserted.clerkUserId,
  };

  { res.status(201).json({
    ...publicPlayer,
    autoLinked: !!linked,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
  }); return; }
});

export default router;
