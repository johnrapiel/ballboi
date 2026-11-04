// Demo data (development only): `pnpm seed:demo`.
//
// Fills John's "Test League 1" with 12 players and three weeks of results, so
// the league, Home and standings look like a real season in week 4. Adds 25
// players who aren't in the league (22 nearby, 3 far away) and two Open
// leagues starting soon, for Discover and messaging.
//
// Every demo player is a real Clerk account ("+clerk_test" email, code
// 424242), so you can sign in as any of them on a second device.
// Safe to re-run: it removes what it made last time, then rebuilds it the
// same way (the scores repeat run to run).

import { clerkClient } from "@clerk/express";
import {
  db,
  leagueAdminsTable,
  leagueInvitesTable,
  leagueRoundByesTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playersTable,
  usersTable,
  type League,
} from "@workspace/db";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { deleteAccount } from "../lib/accountDeletion.js";
import {
  DEMO_AREAS,
  DEMO_COURTS,
  DEMO_EMAIL_PREFIX,
  DEMO_LEAGUE_MARKER,
  DEMO_LEAGUE_PLAYERS,
  DEMO_NEARBY_PLAYERS,
  DEMO_OPEN_LEAGUES,
  demoEmail,
  nyTime,
  seededRandom,
  simulateMatch,
  startForRound,
  type DemoPerson,
} from "../lib/demoData.js";
import { addDays, leagueToday, roundWindow } from "../lib/leagueCalendar.js";
import { seasonDates } from "../lib/leagueSetup.js";
import { ensureDraft, usesWeeklyRounds } from "../services/leagueRounds.js";
import { johnsAccount, Problem } from "./walkthroughData.js";

const quiet = { warn: () => {}, info: () => {} };
const newInviteCode = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);
/** Today falls in this round, so three weeks of results come before it. */
const CURRENT_ROUND = 4;

const fullName = (p: Pick<DemoPerson, "firstName" | "lastName">) => `${p.firstName} ${p.lastName}`;

export interface DemoSummary {
  league: { id: number; name: string; startDate: string; weeks: number; inviteCode: string | null };
  leaguePlayers: number;
  nearby: number;
  farAway: number;
  openLeagues: string[];
  completed: number;
  inGrace: number;
  notPlayed: number;
  johnRecord: { wins: number; losses: number };
  johnsMatchToday: { opponent: string; at: string; location: string } | null;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

/** Clerk ids for every demo account, creating the missing ones. */
async function demoClerkIds(people: DemoPerson[]): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerkClient.users.getUserList({ query: DEMO_EMAIL_PREFIX, limit: 100, offset });
    for (const u of data) for (const e of u.emailAddresses) existing.set(e.emailAddress.toLowerCase(), u.id);
    if (data.length < 100) break;
  }
  const ids = new Map<string, string>();
  for (const p of people) {
    const email = demoEmail(p);
    let id = existing.get(email);
    if (!id) {
      const created = await clerkClient.users.createUser({
        emailAddress: [email],
        firstName: p.firstName,
        lastName: p.lastName,
        skipPasswordRequirement: true,
        unsafeMetadata: { ageCheck: "passed" },
      });
      id = created.id;
    }
    ids.set(email, id);
  }
  return ids;
}

// ─── Finding Test League 1 ───────────────────────────────────────────────────

async function johnsLeague(johnId: string, leagueId: number | null, name: string): Promise<League> {
  if (leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!league) throw new Problem(`No league with id ${leagueId}.`);
    return league;
  }
  const rows = await db
    .select({ league: leaguesTable })
    .from(leaguesTable)
    .innerJoin(leagueAdminsTable, eq(leagueAdminsTable.leagueId, leaguesTable.id))
    .where(and(ilike(leaguesTable.name, name), eq(leagueAdminsTable.clerkUserId, johnId)))
    .orderBy(desc(leaguesTable.id));
  if (!rows.length) {
    throw new Problem(`Couldn't find a league called "${name}" that you run. Pass --league <id> or --name "<league name>".`);
  }
  return rows[0].league;
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/** Removes what the last run made: demo leagues, rounds and matches in John's league, and the demo players. */
async function reset(leagueId: number, johnId: string, demoIds: string[]) {
  const demoLeagues = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.description, DEMO_LEAGUE_MARKER));
  const demoLeagueIds = demoLeagues.map((l) => l.id);
  if (demoLeagueIds.length) {
    await db.delete(matchesTable).where(inArray(matchesTable.leagueId, demoLeagueIds));
    await db.delete(playersTable).where(inArray(playersTable.leagueId, demoLeagueIds));
    await db.delete(leaguesTable).where(inArray(leaguesTable.id, demoLeagueIds));
  }

  // John's league starts over: no rounds or matches, John at 0 and 0.
  await db.delete(matchesTable).where(eq(matchesTable.leagueId, leagueId));
  await db.delete(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId)); // byes go with their rounds
  await db.update(playersTable).set({ wins: 0, losses: 0 }).where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, johnId)));

  if (!demoIds.length) return;
  await db.delete(playersTable).where(inArray(playersTable.clerkUserId, demoIds));
  for (const id of demoIds) {
    await deleteAccount(id, quiet, { deleteClerkUser: async () => undefined });
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function insertProfile(p: DemoPerson, clerkUserId: string, intent: string) {
  const area = DEMO_AREAS[p.zip];
  await db.insert(usersTable).values({
    clerkUserId,
    displayName: fullName(p),
    email: demoEmail(p),
    rating: p.rating,
    ratingSource: "self",
    skillLevel: p.rating.toFixed(1),
    dominantHand: p.hand,
    bio: p.bio,
    homeZip: p.zip,
    homeLatitude: area?.latitude ?? null,
    homeLongitude: area?.longitude ?? null,
    intent,
    intents: [intent],
    onboardingComplete: true,
  });
}

export async function seedDemo(opts: { me: string | null; leagueId: number | null; name: string }): Promise<DemoSummary> {
  const john = await johnsAccount(opts.me);
  const league0 = await johnsLeague(john.id, opts.leagueId, opts.name);
  if (league0.leagueType !== "singles") throw new Problem(`${league0.name} is a doubles league. The demo data fills a singles league.`);
  if (!usesWeeklyRounds(league0)) throw new Problem(`${league0.name} wasn't set up with the new league form (Flex or Round robin, with a season length).`);
  const weeks = league0.seasonWeeks!;
  if (weeks < CURRENT_ROUND + 1) throw new Problem(`${league0.name} is ${weeks} weeks long. Make it at least ${CURRENT_ROUND + 1} weeks so there's history and a current week.`);

  const [johnPlayer] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, league0.id), eq(playersTable.clerkUserId, john.id), isNull(playersTable.leftAt)));
  if (!johnPlayer) throw new Problem(`You're not a player in ${league0.name}. Turn on "I'm playing in this league" or join it, then run this again.`);
  const [johnUser] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, john.id));
  const johnRating = johnUser?.rating ?? (Number(johnPlayer.skillLevel) || 3.5);

  const everyone = [...DEMO_LEAGUE_PLAYERS, ...DEMO_NEARBY_PLAYERS];
  const ids = await demoClerkIds(everyone);
  const idOf = (p: DemoPerson) => ids.get(demoEmail(p))!;
  await reset(league0.id, john.id, [...ids.values()]);

  // Profiles: onboarding done, so each lands on the tabs if you sign in as them.
  for (const p of DEMO_LEAGUE_PLAYERS) await insertProfile(p, idOf(p), "join_league");
  for (const p of DEMO_NEARBY_PLAYERS) await insertProfile(p, idOf(p), "find_matches");

  // Move the season back so today is in round 4, keeping its weekday and length.
  const today = leagueToday();
  const startDate = startForRound(league0.startDate!, today, CURRENT_ROUND);
  const [league] = await db
    .update(leaguesTable)
    .set({ startDate, endDate: seasonDates(startDate, weeks).endDate, status: "active", location: league0.location ?? DEMO_COURTS[0] })
    .where(eq(leaguesTable.id, league0.id))
    .returning();

  // The 12 join, as if they used the invite before the season started.
  const leaguePlayers = await db
    .insert(playersTable)
    .values(DEMO_LEAGUE_PLAYERS.map((p) => ({ name: fullName(p), clerkUserId: idOf(p), leagueId: league.id, skillLevel: p.rating.toFixed(1), dominantHand: p.hand, bio: p.bio })))
    .returning();
  const ratingOf = new Map<number, number>([[johnPlayer.id, johnRating], ...leaguePlayers.map((p) => [p.id, Number(p.skillLevel)] as [number, number])]);
  const nameOf = new Map<number, string>([[johnPlayer.id, johnPlayer.name], ...leaguePlayers.map((p) => [p.id, p.name] as [number, string])]);

  // Nearby players get a player profile too, so they can be messaged and reported.
  await db.insert(playersTable).values(DEMO_NEARBY_PLAYERS.map((p) => ({ name: fullName(p), clerkUserId: idOf(p), skillLevel: p.rating.toFixed(1), dominantHand: p.hand, bio: p.bio })));

  const rand = seededRandom(20261102);
  const record = new Map<number, { wins: number; losses: number }>();
  const tally = (id: number, won: boolean) => {
    const r = record.get(id) ?? { wins: 0, losses: 0 };
    if (won) r.wins++;
    else r.losses++;
    record.set(id, r);
  };
  let completed = 0;
  let inGrace = 0;
  let notPlayed = 0;
  let johnsMatchToday: DemoSummary["johnsMatchToday"] = null;

  for (let n = 1; n <= CURRENT_ROUND; n++) {
    const w = roundWindow(startDate, n);
    const draft = await ensureDraft(league, n);
    if (!draft) throw new Problem(`Couldn't pair round ${n}.`);
    const round = draft.round;
    // Sent out on its start morning. Done directly (not publishRound) so nobody gets a push for old rounds.
    await db
      .update(leagueRoundsTable)
      .set({ publishedAt: new Date(nyTime(w.startDate, 7)), status: n < CURRENT_ROUND ? "completed" : "active" })
      .where(eq(leagueRoundsTable.id, round.id));

    let matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);

    // This week, John always has a match: if the pairing gave him the bye, he takes someone's spot.
    if (n === CURRENT_ROUND && !matches.some((m) => m.player1Id === johnPlayer.id || m.player2Id === johnPlayer.id)) {
      const swap = matches[0];
      await db.update(matchesTable).set({ player2Id: johnPlayer.id }).where(eq(matchesTable.id, swap.id));
      await db
        .update(leagueRoundByesTable)
        .set({ playerId: swap.player2Id })
        .where(and(eq(leagueRoundByesTable.roundId, round.id), eq(leagueRoundByesTable.playerId, johnPlayer.id)));
      matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);
    }

    for (const [i, m] of matches.entries()) {
      const hasJohn = m.player1Id === johnPlayer.id || m.player2Id === johnPlayer.id;
      const location = DEMO_COURTS[Math.floor(rand() * DEMO_COURTS.length)];
      const playDay = addDays(w.startDate, Math.floor(rand() * 6));
      const hour = rand() < 0.35 ? 9 : rand() < 0.5 ? 17 : 18;
      const minute = rand() < 0.5 ? 0 : 30;

      // What happened to this match.
      let outcome: "played" | "grace" | "open";
      if (n === CURRENT_ROUND) {
        // This week: John's is tonight; a few others already played earlier in the week.
        outcome = !hasJohn && i % 3 === 1 && today > w.startDate ? "played" : "open";
      } else if (n === CURRENT_ROUND - 1) {
        // Last week (now in its grace week): one played late, one still waiting.
        outcome = i === matches.length - 1 && !hasJohn ? "open" : i === matches.length - 2 && !hasJohn ? "grace" : "played";
      } else if (n === 2 && i === matches.length - 1 && !hasJohn) {
        outcome = "open"; // Never played: shows "Not played" after the grace week.
      } else {
        outcome = "played";
      }

      if (outcome === "open") {
        if (n === CURRENT_ROUND && hasJohn) {
          const at = nyTime(today, 18);
          await db.update(matchesTable).set({ scheduledAt: at, location: DEMO_COURTS[0] }).where(eq(matchesTable.id, m.id));
          const opp = m.player1Id === johnPlayer.id ? m.player2Id : m.player1Id;
          johnsMatchToday = { opponent: nameOf.get(opp) ?? "?", at, location: DEMO_COURTS[0] };
        } else if (n === CURRENT_ROUND) {
          // Scheduled for later this week, or not scheduled yet.
          const later = addDays(today, 1 + Math.floor(rand() * Math.max(1, Math.min(5, daysLeft(today, w.deadline)))));
          if (rand() < 0.6 && later <= w.deadline) {
            await db.update(matchesTable).set({ scheduledAt: nyTime(later, hour, minute), location }).where(eq(matchesTable.id, m.id));
          }
        } else {
          notPlayed++;
        }
        continue;
      }

      const late = outcome === "grace";
      // Late: the day after the deadline. This week: yesterday. Earlier weeks: any day of the week.
      const day = late ? addDays(w.deadline, 1) : n === CURRENT_ROUND ? addDays(today, -1) : playDay;
      const startedAt = day < today ? nyTime(day, hour, minute) : nyTime(day, 7);
      const minutes = 70 + Math.floor(rand() * 60);
      const doneAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
      const { score, winnerSide } = simulateMatch(rand, ratingOf.get(m.player1Id) ?? 3.5, ratingOf.get(m.player2Id) ?? 3.5);
      const winnerId = winnerSide === 1 ? m.player1Id : m.player2Id;
      const loserId = winnerSide === 1 ? m.player2Id : m.player1Id;
      const enteredBy = rand() < 0.65 ? winnerId : loserId;
      const enteredByClerk = enteredBy === johnPlayer.id ? john.id : leaguePlayers.find((p) => p.id === enteredBy)?.clerkUserId ?? null;
      await db
        .update(matchesTable)
        .set({
          status: "completed",
          score,
          winnerId,
          scheduledAt: startedAt,
          startedAt,
          completedAt: doneAt,
          recordedAt: doneAt,
          recordedByClerkUserId: enteredByClerk,
          durationMinutes: minutes,
          location,
          inGrace: late,
        })
        .where(eq(matchesTable.id, m.id));
      completed++;
      if (late) {
        inGrace++; // Counts for stats, not standings (decision 25).
      } else {
        tally(winnerId, true);
        tally(loserId, false);
      }
    }
  }

  // Standings come from each player's league record.
  for (const [playerId, r] of record) {
    await db.update(playersTable).set({ wins: r.wins, losses: r.losses }).where(eq(playersTable.id, playerId));
  }

  const [invite] = await db
    .select({ code: leagueInvitesTable.code })
    .from(leagueInvitesTable)
    .where(and(eq(leagueInvitesTable.leagueId, league.id), eq(leagueInvitesTable.isActive, true)))
    .limit(1);

  // Two Open leagues nearby, starting soon, run by demo players.
  const nearbyByName = new Map(DEMO_NEARBY_PLAYERS.map((p) => [fullName(p), p]));
  for (const o of DEMO_OPEN_LEAGUES) {
    const organizer = nearbyByName.get(o.organizer)!;
    const start = addDays(today, o.startsInDays);
    const [openLeague] = await db
      .insert(leaguesTable)
      .values({
        name: o.name,
        description: DEMO_LEAGUE_MARKER,
        format: o.format,
        status: "upcoming",
        leagueType: "singles",
        visibility: "open",
        minRating: o.minRating,
        maxRating: o.maxRating,
        rosterCap: o.rosterCap,
        startDate: start,
        endDate: seasonDates(start, o.weeks).endDate,
        seasonWeeks: o.weeks,
        playoffSize: 4,
        location: o.location,
        createdByClerkUserId: idOf(organizer),
      })
      .returning();
    await db.insert(leagueAdminsTable).values({ leagueId: openLeague.id, clerkUserId: idOf(organizer), role: "owner" });
    await db.insert(leagueInvitesTable).values({ code: newInviteCode(), leagueId: openLeague.id, createdByClerkUserId: idOf(organizer), isActive: true });
    await db.insert(playersTable).values(
      [organizer, ...o.members.map((name) => nearbyByName.get(name)!)].map((p) => ({
        name: fullName(p),
        clerkUserId: idOf(p),
        leagueId: openLeague.id,
        skillLevel: p.rating.toFixed(1),
        dominantHand: p.hand,
        bio: p.bio,
      })),
    );
  }

  const farAway = DEMO_NEARBY_PLAYERS.filter((p) => ["11215", "10025", "02139"].includes(p.zip)).length;
  const [johnNow] = await db.select({ wins: playersTable.wins, losses: playersTable.losses }).from(playersTable).where(eq(playersTable.id, johnPlayer.id));

  return {
    league: { id: league.id, name: league.name, startDate, weeks, inviteCode: invite?.code ?? null },
    leaguePlayers: DEMO_LEAGUE_PLAYERS.length,
    nearby: DEMO_NEARBY_PLAYERS.length - farAway,
    farAway,
    openLeagues: DEMO_OPEN_LEAGUES.map((o) => o.name),
    completed,
    inGrace,
    notPlayed,
    johnRecord: johnNow ?? { wins: 0, losses: 0 },
    johnsMatchToday,
  };
}

function daysLeft(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
