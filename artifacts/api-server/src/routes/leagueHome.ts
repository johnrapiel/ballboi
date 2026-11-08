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
import { todayFor } from "../lib/leagueCalendar.js";
import { allResults, buildLeagueHome, casualResults, homeLeagues, seasonFrom } from "../lib/leagueHome.js";
import { computeStandings } from "../lib/leagueStandings.js";
import { getPastSeasonNames } from "../services/seasonService.js";
import { playoffPlayBy } from "../services/leaguePlayoffs.js";

// Home tab's league section (spec: Navigation > Home): this week's matches
// and byes across every league you play in, playoff matches, pairings you
// need to review as an admin, and your last five results. `results` also
// carries your Discover and Quick match results for Profile's Results tab
// (decision 151); they never count toward `recent` or `season`.

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
  const now = new Date();
  // inArray needs at least one id; -1 matches nothing.
  const ids = myIds.length ? myIds : [-1];
  const myMatches = () =>
    myIds.length
      ? db
          .select()
          .from(matchesTable)
          .where(or(
            inArray(matchesTable.player1Id, ids),
            inArray(matchesTable.player2Id, ids),
            inArray(matchesTable.player3Id, ids),
            inArray(matchesTable.player4Id, ids),
          ))
      : Promise.resolve([] as (typeof matchesTable.$inferSelect)[]);
  const namesFor = async (matches: (typeof matchesTable.$inferSelect)[]) => {
    const others = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
    const rows = others.length
      ? await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, others))
      : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  };

  if (leagueIds.length === 0) {
    const matches = await myMatches();
    const casual = casualResults({ matches, myPlayerIds: myIds, names: await namesFor(matches) });
    res.json({ today: todayFor(null, now), thisWeek: [], playoffs: [], drafts: [], recent: [], results: allResults([], casual), season: seasonFrom([]), leagues: [] });
    return;
  }

  const [leagues, rounds, matches, byes] = await Promise.all([
    db.select().from(leaguesTable).where(inArray(leaguesTable.id, leagueIds)),
    db.select().from(leagueRoundsTable).where(inArray(leagueRoundsTable.leagueId, leagueIds)),
    myMatches(),
    db.select({ roundId: leagueRoundByesTable.roundId, playerId: leagueRoundByesTable.playerId }).from(leagueRoundByesTable).where(inArray(leagueRoundByesTable.playerId, ids)),
  ]);
  const names = await namesFor(matches);

  // Q5b: each open playoff match's play-by date.
  const playBys = new Map<number, string>();
  for (const m of matches) {
    if (!m.playoffBracketId || m.status === "completed" || m.voidedAt) continue;
    const league = leagues.find((l) => l.id === m.leagueId);
    const playBy = league ? await playoffPlayBy(league, m) : null;
    if (playBy) playBys.set(m.id, playBy);
  }

  // Finding 14: standings for each league you play in, as the league page
  // ranks them (past seasons left out).
  const playingIn = [...new Set(myPlayers.filter((p) => !p.leftAt && p.leagueId != null).map((p) => p.leagueId!))];
  const standings = new Map<number, ReturnType<typeof computeStandings>>();
  if (playingIn.length) {
    const [leaguePlayers, leagueMatches] = await Promise.all([
      db.select().from(playersTable).where(inArray(playersTable.leagueId, playingIn)),
      db.select().from(matchesTable).where(inArray(matchesTable.leagueId, playingIn)),
    ]);
    for (const id of playingIn) {
      const past = await getPastSeasonNames(id);
      standings.set(
        id,
        computeStandings(
          leaguePlayers.filter((p) => p.leagueId === id),
          leagueMatches.filter((m) => m.leagueId === id),
          (season) => season === null || !past.includes(season),
        ),
      );
    }
  }

  const home = buildLeagueHome({
    now,
    myPlayers,
    leagues,
    // An ended league has no week to play (decision 31).
    rounds: rounds.filter((r) => !leagues.find((l) => l.id === r.leagueId)?.endedAt),
    matches: matches.filter((m) => m.leagueId != null && leagueIds.includes(m.leagueId)),
    byes,
    names,
    adminLeagueIds,
    playoffPlayBy: playBys,
  });
  res.json({
    ...home,
    results: allResults(home.results, casualResults({ matches, myPlayerIds: myIds, names })),
    leagues: homeLeagues({ myPlayers, leagues, standings }),
  });
});

export default router;
