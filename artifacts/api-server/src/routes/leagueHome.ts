import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  leagueAdminsTable,
  leagueRoundByesTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playersTable,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import { leagueToday } from "../lib/leagueCalendar.js";
import { buildLeagueHome } from "../lib/leagueHome.js";

// Home tab's league section (spec: Navigation > Home): this week's matches
// and byes across every league you play in, playoff matches, pairings you
// need to review as an admin, and your last five results.

const router = Router();

router.get("/me/league-week", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [myPlayers, adminRows] = await Promise.all([
    db.select().from(playersTable).where(eq(playersTable.clerkUserId, userId)),
    db.select({ leagueId: leagueAdminsTable.leagueId }).from(leagueAdminsTable).where(eq(leagueAdminsTable.clerkUserId, userId)),
  ]);
  const myIds = myPlayers.map((p) => p.id);
  const adminLeagueIds = adminRows.map((a) => a.leagueId);
  const leagueIds = [...new Set([...myPlayers.map((p) => p.leagueId).filter((id): id is number => id != null), ...adminLeagueIds])];
  const today = leagueToday();
  if (leagueIds.length === 0) {
    res.json({ today, thisWeek: [], playoffs: [], drafts: [], recent: [] });
    return;
  }

  // inArray needs at least one id; -1 matches nothing.
  const ids = myIds.length ? myIds : [-1];
  const [leagues, rounds, matches, byes] = await Promise.all([
    db.select({ id: leaguesTable.id, name: leaguesTable.name, leagueType: leaguesTable.leagueType }).from(leaguesTable).where(inArray(leaguesTable.id, leagueIds)),
    db.select().from(leagueRoundsTable).where(inArray(leagueRoundsTable.leagueId, leagueIds)),
    db
      .select()
      .from(matchesTable)
      .where(or(
        inArray(matchesTable.player1Id, ids),
        inArray(matchesTable.player2Id, ids),
        inArray(matchesTable.player3Id, ids),
        inArray(matchesTable.player4Id, ids),
      )),
    db.select({ roundId: leagueRoundByesTable.roundId, playerId: leagueRoundByesTable.playerId }).from(leagueRoundByesTable).where(inArray(leagueRoundByesTable.playerId, ids)),
  ]);
  const others = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
  const nameRows = others.length
    ? await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, others))
    : [];

  res.json(
    buildLeagueHome({
      today,
      myPlayers,
      leagues,
      rounds,
      matches: matches.filter((m) => m.leagueId != null && leagueIds.includes(m.leagueId)),
      byes,
      names: new Map(nameRows.map((r) => [r.id, r.name])),
      adminLeagueIds,
    }),
  );
});

export default router;
