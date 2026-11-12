// Doubles demo data (Wave 2 walkthrough, section 4): three doubles leagues run
// by John, so the doubles screens have something to show on staging. Called
// from demoSeed.ts, which removes everything here before each run, so running
// it twice gives the same leagues again.
//
// - Tuesday Doubles: fixed partners, 8 players in 4 teams plus one player on
//   "Find me a partner" (so Manage > Teams has something to show). Matches are
//   on Tuesdays at 7 PM. Two weeks played; John's team plays this Tuesday.
//   Standings by team.
// - Rotating Doubles Night: rotating partners, 9 players, so one bye each
//   week. Two weeks played; John is in a four this week. Standings by player.
// - Winter Doubles: fixed partners, starts in 6 days. John has no partner yet,
//   one team is set, and three others have no partner: one asked John to team
//   up, one is on "Find me a partner", one hasn't done either.
//
// Teams, requests and "Find me a partner" go through the app's own partners
// service (push turned off), and rounds through the app's own doubles pairing
// (ensureDraft), the same code the app runs (#212).
//
// Doubles match chats (D6) aren't made here. The staging API keeps chat
// messages in its own memory and saves them as one snapshot, so a chat made
// from here would be missing from the running API (sending in it would fail)
// and saving could write over testers' messages. The API opens each match's
// chat itself: when one of the four taps Message, or the day before a match
// with a set time.

import { db, leagueRoundByesTable, leagueRoundsTable, matchesTable, playersTable, type League, type Match } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEMO_COURTS, nyTime, simulateMatch, simulateMatchWon } from "../lib/demoData.js";
import { areaForZip } from "../lib/discoverArea.js";
import { addDays, roundWindow } from "../lib/leagueCalendar.js";
import { seasonDates } from "../lib/leagueSetup.js";
import { DrizzleDoublesPartnersRepo } from "../lib/doublesPartnersRepo.js";
import { DoublesPartnersService } from "../services/doublesPartners.js";
import { ensureDraft } from "../services/leagueRounds.js";
import { Problem } from "./walkthroughData.js";

/** Who plays where. Every name is a demo player the seed already makes for staging (no new accounts). */
export const DEMO_DOUBLES = {
  fixed: {
    name: "Tuesday Doubles",
    location: "Robinson Lane courts, Wappingers Falls",
    areaZip: "12590",
    weeks: 8,
    /** Tuesday, 7 PM (league match time). */
    matchDay: 2,
    matchTime: "19:00",
    /** John's partner. They teamed up with a request John accepted. */
    johnsPartner: "Maya Chen",
    /** Teamed up by John in Manage before the season. */
    teams: [
      ["Elena Ortiz", "Diego Alvarez"],
      ["Priya Raman", "Ben Russo"],
      ["Jordan Brooks", "Kate Sullivan"],
    ],
    /** Joined last, odd one out at round 1, on "Find me a partner". */
    looking: "Hannah Lee",
    /** John's team: won week 1, lost week 2. */
    johnResults: [true, false],
  },
  rotating: {
    name: "Rotating Doubles Night",
    location: "Spratt Park, Poughkeepsie",
    areaZip: "12601",
    weeks: 8,
    members: ["Marcus Hall", "Tom Kowalski", "Aisha Mensah", "Sam Whitaker", "Grace Adeyemi", "Luis Moreno", "Megan Doyle", "Will Turner"],
    /** John's results in the weeks he played. */
    johnResults: [true, false],
  },
  upcoming: {
    name: "Winter Doubles",
    location: "Memorial Park, Beacon",
    areaZip: "12508",
    weeks: 6,
    startsInDays: 6,
    team: ["Nate Fischer", "Andre Thomas"],
    /** Sent John a team-up request a few hours before the seed ran. */
    asksJohn: "Ryan O'Connor",
    /** On "Find me a partner". */
    looking: "Leah Goldberg",
    /** No partner, hasn't asked anyone. */
    noPartner: "Kenji Watanabe",
  },
} as const;

/** Every demo player the doubles leagues name. */
export function doublesDemoNames(): string[] {
  const d = DEMO_DOUBLES;
  return [
    d.fixed.johnsPartner,
    ...d.fixed.teams.flat(),
    d.fixed.looking,
    ...d.rotating.members,
    ...d.upcoming.team,
    d.upcoming.asksJohn,
    d.upcoming.looking,
    d.upcoming.noPartner,
  ];
}

/** Round 3 runs Wednesday to Tuesday and holds today, so this week's Tuesday match is today or later. */
export function tuesdaySeasonStart(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday
  const sinceWednesday = (weekday - 3 + 7) % 7;
  return addDays(today, -sinceWednesday - 14);
}

export const DOUBLES_CURRENT_ROUND = 3;

type Member = { name: string; clerkUserId: string; rating: number; hand: string; bio: string | null };
type Player = typeof playersTable.$inferSelect;

export interface DoublesDeps {
  today: string;
  rand: () => number;
  john: { clerkId: string; name: string; rating: number };
  johnMember: Member;
  memberOf: (name: string) => Member;
  createLeague: (values: typeof import("@workspace/db").leaguesTable.$inferInsert, owner: string, members: Member[]) => Promise<{ league: League; players: Player[] }>;
  marker: string;
}

export interface DoublesMatchView {
  partner: string | null;
  opponents: string[];
  at: string | null;
  location: string | null;
}

export interface DoublesSummary {
  fixed: {
    id: number;
    name: string;
    players: number;
    teams: number;
    looking: number;
    played: number;
    johnsTeamRecord: { wins: number; losses: number };
    johnsMatch: DoublesMatchView | null;
  };
  rotating: {
    id: number;
    name: string;
    players: number;
    played: number;
    byesThisWeek: number;
    johnRecord: { wins: number; losses: number };
    johnsMatch: DoublesMatchView | null;
  };
  upcoming: {
    id: number;
    name: string;
    players: number;
    teams: number;
    withoutPartner: number;
    requestsToJohn: number;
    looking: number;
    startDate: string;
  };
}

const quietPush = async () => {};

function areaFields(zip: string) {
  const a = areaForZip(zip);
  return a ? { areaZip: zip, areaTown: a.town, areaState: a.state, areaLatitude: a.point.latitude, areaLongitude: a.point.longitude } : {};
}

const sides = (m: Match) => [
  [m.player1Id, m.player3Id!],
  [m.player2Id, m.player4Id!],
];
const hasPlayer = (m: Match, id: number) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id].includes(id);

/**
 * Pairs and plays a doubles league's rounds with the app's own pairing, then
 * writes results as if a player entered them: both players on the winning
 * side get the win (the same as score entry). Rounds are marked sent on their
 * start morning, directly, so nobody gets a push for old rounds.
 */
async function playDoubles(
  deps: DoublesDeps,
  league: League,
  johnPlayerId: number,
  opts: {
    johnResults: boolean[];
    /** John's match this week, when the league has no match time. */
    johnsTime?: { date: string; hour: number; minute: number };
    location: (rand: () => number) => string;
  },
): Promise<{ played: number; byesThisWeek: number; johnsMatch: DoublesMatchView | null }> {
  const { today, rand } = deps;
  const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, league.id));
  const byId = new Map(players.map((p) => [p.id, p]));
  const ratingOf = (id: number) => (id === johnPlayerId ? deps.john.rating : Number(byId.get(id)?.skillLevel) || 3.5);
  const nameOf = (id: number) => (id === johnPlayerId ? deps.john.name : byId.get(id)?.name ?? "Player");
  const record = new Map<number, { wins: number; losses: number }>();
  const tally = (ids: number[], won: boolean) => {
    for (const id of ids) {
      const r = record.get(id) ?? { wins: 0, losses: 0 };
      if (won) r.wins++;
      else r.losses++;
      record.set(id, r);
    }
  };
  let played = 0;
  let byesThisWeek = 0;
  let johnGames = 0;
  let johnsMatch: DoublesMatchView | null = null;

  for (let n = 1; n <= DOUBLES_CURRENT_ROUND; n++) {
    const w = roundWindow(league.startDate!, n);
    const draft = await ensureDraft(league, n);
    if (!draft) throw new Problem(`Couldn't pair round ${n} of ${league.name}.`);
    const round = draft.round;
    const status = today > w.deadline ? "completed" : today >= w.startDate ? "active" : "upcoming";
    await db.update(leagueRoundsTable).set({ publishedAt: new Date(nyTime(w.startDate, 7)), status }).where(eq(leagueRoundsTable.id, round.id));
    const isCurrent = n === DOUBLES_CURRENT_ROUND;

    let matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);
    // This week John always plays: if the pairing gave him a bye, he takes the seat of the closest level.
    if (isCurrent && !matches.some((m) => hasPlayer(m, johnPlayerId))) {
      if (!matches.length) throw new Problem(`Round ${n} of ${league.name} has no matches.`);
      const m = matches[0];
      const seats = [
        ["player1Id", m.player1Id],
        ["player2Id", m.player2Id],
        ["player3Id", m.player3Id!],
        ["player4Id", m.player4Id!],
      ] as const;
      const [seat, out] = [...seats].sort((a, b) => Math.abs(ratingOf(a[1]) - deps.john.rating) - Math.abs(ratingOf(b[1]) - deps.john.rating))[0];
      await db.update(matchesTable).set({ [seat]: johnPlayerId }).where(eq(matchesTable.id, m.id));
      await db
        .update(leagueRoundByesTable)
        .set({ playerId: out })
        .where(and(eq(leagueRoundByesTable.roundId, round.id), eq(leagueRoundByesTable.playerId, johnPlayerId)));
      matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);
    }
    if (isCurrent) {
      byesThisWeek = (await db.select().from(leagueRoundByesTable).where(eq(leagueRoundByesTable.roundId, round.id))).length;
    }

    for (const [i, m] of matches.entries()) {
      const hasJohn = hasPlayer(m, johnPlayerId);
      const location = opts.location(rand);
      const [side1, side2] = sides(m);

      if (isCurrent) {
        // This week: nobody has played yet.
        let at = m.scheduledAt;
        if (hasJohn && opts.johnsTime) at = nyTime(opts.johnsTime.date, opts.johnsTime.hour, opts.johnsTime.minute);
        else if (!at && i % 2 === 1) at = nyTime(addDays(today, 1), 18, 30); // the other four set a time; some haven't yet
        await db.update(matchesTable).set({ scheduledAt: at, location: at ? location : null }).where(eq(matchesTable.id, m.id));
        if (hasJohn) {
          const mine = side1.includes(johnPlayerId) ? side1 : side2;
          const theirs = mine === side1 ? side2 : side1;
          const partner = mine.find((id) => id !== johnPlayerId)!;
          johnsMatch = { partner: nameOf(partner), opponents: theirs.map(nameOf), at, location: at ? location : null };
        }
        continue;
      }

      // Earlier weeks: every match played, on the league's match day when it has one.
      const day = m.scheduledAt ? null : addDays(w.startDate, Math.floor(rand() * 7));
      const startedAt = m.scheduledAt ?? nyTime(day!, rand() < 0.5 ? 18 : 19, rand() < 0.5 ? 0 : 30);
      const minutes = 75 + Math.floor(rand() * 45);
      const doneAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
      const r1 = (ratingOf(side1[0]) + ratingOf(side1[1])) / 2;
      const r2 = (ratingOf(side2[0]) + ratingOf(side2[1])) / 2;
      let sim: { score: string; winnerSide: 1 | 2 };
      if (hasJohn) {
        const johnSide = side1.includes(johnPlayerId) ? 1 : 2;
        const johnWins = opts.johnResults[johnGames++ % opts.johnResults.length];
        sim = simulateMatchWon(rand, r1, r2, johnWins ? johnSide : johnSide === 1 ? 2 : 1);
      } else {
        sim = simulateMatch(rand, r1, r2);
      }
      const winners = sim.winnerSide === 1 ? side1 : side2;
      const losers = sim.winnerSide === 1 ? side2 : side1;
      // Doubles store the winning team by its first player (player1 or player2).
      const winnerId = sim.winnerSide === 1 ? m.player1Id : m.player2Id;
      const enteredBy = winners[Math.floor(rand() * 2)];
      await db
        .update(matchesTable)
        .set({
          status: "completed",
          score: sim.score,
          winnerId,
          scheduledAt: startedAt,
          startedAt,
          completedAt: doneAt,
          recordedAt: doneAt,
          recordedByClerkUserId: enteredBy === johnPlayerId ? deps.john.clerkId : byId.get(enteredBy)?.clerkUserId ?? null,
          durationMinutes: minutes,
          location,
          inGrace: false,
        })
        .where(eq(matchesTable.id, m.id));
      played++;
      tally(winners, true);
      tally(losers, false);
    }
  }

  for (const [playerId, r] of record) {
    await db.update(playersTable).set({ wins: r.wins, losses: r.losses }).where(eq(playersTable.id, playerId));
  }
  return { played, byesThisWeek, johnsMatch };
}

/** Makes the three doubles leagues. Run after the reset, like the rest of the demo seed. */
export async function seedDoublesDemo(deps: DoublesDeps): Promise<DoublesSummary> {
  const { today, john } = deps;
  const d = DEMO_DOUBLES;
  const now = Date.now();
  // Push stays off: nobody hears about seeded teams or requests.
  const partners = (at: Date = new Date(now)) => new DoublesPartnersService(new DrizzleDoublesPartnersRepo(), quietPush, () => at);
  const idIn = (players: Player[], clerkUserId: string) => players.find((p) => p.clerkUserId === clerkUserId)!.id;

  // ── Tuesday Doubles: fixed partners, two weeks played, John's team plays this Tuesday.
  const fixedStart = tuesdaySeasonStart(today);
  const fixedMembers = [deps.johnMember, deps.memberOf(d.fixed.johnsPartner), ...d.fixed.teams.flat().map(deps.memberOf), deps.memberOf(d.fixed.looking)];
  const { league: fixed, players: fixedPlayers } = await deps.createLeague(
    {
      name: d.fixed.name,
      description: deps.marker,
      format: "flex",
      status: "active",
      leagueType: "doubles",
      partnerMode: "fixed",
      visibility: "private",
      startDate: fixedStart,
      endDate: seasonDates(fixedStart, d.fixed.weeks).endDate,
      seasonWeeks: d.fixed.weeks,
      playoffSize: 0, // playoffs are hidden for doubles (D8)
      location: d.fixed.location,
      matchDay: d.fixed.matchDay,
      matchTime: d.fixed.matchTime,
      createdByClerkUserId: john.clerkId,
      ...areaFields(d.fixed.areaZip),
    },
    john.clerkId,
    fixedMembers,
  );
  // Before the season: the requests and Manage team-ups, the way players and John made them.
  const preseason = new Date(nyTime(addDays(fixedStart, -5), 20));
  const johnInFixed = idIn(fixedPlayers, john.clerkId);
  const maya = deps.memberOf(d.fixed.johnsPartner);
  const asked = await partners(preseason).request(fixed.id, maya.clerkUserId, johnInFixed);
  const toJohn = (await partners(preseason).mine(fixed.id, john.clerkId)).incoming[0];
  if (!asked.outgoing || !toJohn) throw new Problem(`Couldn't set up the team-up request in ${fixed.name}.`);
  await partners(new Date(preseason.getTime() + 3_600_000)).respond(fixed.id, john.clerkId, toJohn.requestId, true);
  for (const [a, b] of d.fixed.teams) {
    await partners(preseason).teamUp(fixed.id, idIn(fixedPlayers, deps.memberOf(a).clerkUserId), idIn(fixedPlayers, deps.memberOf(b).clerkUserId));
  }
  await partners(new Date(nyTime(addDays(fixedStart, -2), 12))).setLooking(fixed.id, deps.memberOf(d.fixed.looking).clerkUserId, true);
  const fixedPlay = await playDoubles(deps, fixed, johnInFixed, { johnResults: [...d.fixed.johnResults], location: () => d.fixed.location });
  const fixedTeams = await partners().manage(fixed.id);
  const johnsTeam = fixedTeams.teams.find((t) => t.players.some((p) => p.playerId === johnInFixed));
  if (!johnsTeam) throw new Problem(`John has no team in ${fixed.name}.`);
  const [johnRow] = await db.select().from(playersTable).where(eq(playersTable.id, johnInFixed));

  // ── Rotating Doubles Night: 9 players, two weeks played, John in a four this week.
  const s = d.rotating;
  const rotatingStart = addDays(today, -(2 * 7 + 1)); // today is day 2 of week 3
  const { league: rotating, players: rotatingPlayers } = await deps.createLeague(
    {
      name: s.name,
      description: deps.marker,
      format: "flex",
      status: "active",
      leagueType: "doubles",
      partnerMode: "rotating",
      visibility: "private",
      startDate: rotatingStart,
      endDate: seasonDates(rotatingStart, s.weeks).endDate,
      seasonWeeks: s.weeks,
      playoffSize: 0,
      location: s.location,
      createdByClerkUserId: john.clerkId,
      ...areaFields(s.areaZip),
    },
    john.clerkId,
    [deps.johnMember, ...s.members.map(deps.memberOf)],
  );
  const johnInRotating = idIn(rotatingPlayers, john.clerkId);
  const rotatingPlay = await playDoubles(deps, rotating, johnInRotating, {
    johnResults: [...s.johnResults],
    johnsTime: { date: addDays(today, 2), hour: 19, minute: 30 },
    location: (rand) => DEMO_COURTS[Math.floor(rand() * DEMO_COURTS.length)],
  });
  const [johnRotating] = await db.select().from(playersTable).where(eq(playersTable.id, johnInRotating));

  // ── Winter Doubles: before its season. John has no partner; someone asked him.
  const u = d.upcoming;
  const upcomingStart = addDays(today, u.startsInDays);
  const { league: upcoming, players: upcomingPlayers } = await deps.createLeague(
    {
      name: u.name,
      description: deps.marker,
      format: "flex",
      status: "upcoming",
      leagueType: "doubles",
      partnerMode: "fixed",
      visibility: "private",
      startDate: upcomingStart,
      endDate: seasonDates(upcomingStart, u.weeks).endDate,
      seasonWeeks: u.weeks,
      playoffSize: 0,
      location: u.location,
      createdByClerkUserId: john.clerkId,
      ...areaFields(u.areaZip),
    },
    john.clerkId,
    [deps.johnMember, ...u.team.map(deps.memberOf), deps.memberOf(u.asksJohn), deps.memberOf(u.looking), deps.memberOf(u.noPartner)],
  );
  const johnInUpcoming = idIn(upcomingPlayers, john.clerkId);
  const upId = (name: string) => idIn(upcomingPlayers, deps.memberOf(name).clerkUserId);
  await partners(new Date(now - 2 * 86_400_000)).teamUp(upcoming.id, upId(u.team[0]), upId(u.team[1]));
  await partners(new Date(now - 26 * 3_600_000)).setLooking(upcoming.id, deps.memberOf(u.looking).clerkUserId, true);
  // A few hours ago, so it's well inside its 48 hours.
  await partners(new Date(now - 3 * 3_600_000)).request(upcoming.id, deps.memberOf(u.asksJohn).clerkUserId, johnInUpcoming);
  const johnsView = await partners().mine(upcoming.id, john.clerkId);
  const upcomingTeams = await partners().manage(upcoming.id);

  return {
    fixed: {
      id: fixed.id,
      name: fixed.name,
      players: fixedPlayers.length,
      teams: fixedTeams.teams.length,
      looking: fixedTeams.unpaired.filter((p) => p.kind === "looking").length,
      played: fixedPlay.played,
      johnsTeamRecord: { wins: johnRow?.wins ?? 0, losses: johnRow?.losses ?? 0 },
      johnsMatch: fixedPlay.johnsMatch,
    },
    rotating: {
      id: rotating.id,
      name: rotating.name,
      players: rotatingPlayers.length,
      played: rotatingPlay.played,
      byesThisWeek: rotatingPlay.byesThisWeek,
      johnRecord: { wins: johnRotating?.wins ?? 0, losses: johnRotating?.losses ?? 0 },
      johnsMatch: rotatingPlay.johnsMatch,
    },
    upcoming: {
      id: upcoming.id,
      name: upcoming.name,
      players: upcomingPlayers.length,
      teams: upcomingTeams.teams.length,
      withoutPartner: upcomingTeams.unpaired.length,
      requestsToJohn: johnsView.incoming.length,
      looking: upcomingTeams.unpaired.filter((p) => p.kind === "looking").length,
      startDate: upcomingStart,
    },
  };
}
