// Demo data (development and staging test data): `pnpm seed:demo`, and the
// "Seed staging data" GitHub Action.
//
// What it makes, all around the Hudson Valley:
// - Test League 1 (Private, run by John): 13 players with John, today is the
//   last day of week 4. Three weeks of results, John's match tonight, a
//   pending join request, and round 5's pairings waiting for his review.
// - Dutchess County Singles (Open, run by John): full at 10, today is day 2
//   of week 3, John's match later this week, and three players on the waitlist.
// - Hudson Valley Summer Singles (Private, ended): final standings and a
//   finished top-8 playoff, with a walkover.
// - About 30 nearby players for Discover (3 far away who shouldn't show), and
//   two Open leagues starting soon.
//
// Every demo player is a real Clerk account ("+clerk_test" email, code
// 424242), created only if missing, so you can sign in as any of them.
// Safe to re-run: it removes what it made last time (demo accounts' data,
// demo leagues, and the rounds and matches in Test League 1), then rebuilds
// it the same way. It never touches other people's data or the schema.
//
// Messages aren't seeded: staging keeps messages in the API's memory, so
// anything written from here would never reach the app.

import { clerkClient } from "@clerk/express";
import {
  db,
  leagueAdminsTable,
  leagueInvitesTable,
  leagueJoinRequestsTable,
  leagueRoundByesTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playersTable,
  playoffBracketsTable,
  usersTable,
  type League,
  type PlayoffSeeding,
} from "@workspace/db";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { deleteAccount } from "../lib/accountDeletion.js";
import {
  DEMO_AREAS,
  DEMO_COURTS,
  DEMO_EMAIL_PREFIX,
  DEMO_JOIN_REQUEST,
  DEMO_LEAGUE_MARKER,
  DEMO_LEAGUE_PLAYERS,
  DEMO_NEARBY_PLAYERS,
  DEMO_OPEN_LEAGUES,
  DEMO_PAST_LEAGUE,
  DEMO_SECOND_LEAGUE,
  demoEmail,
  hasMatchTiebreak,
  nyTime,
  retirementScore,
  seededRandom,
  setWinChance,
  simulateMatch,
  simulateMatchWon,
  startForDeadlineDay,
  startForRoundDay,
  type DemoPerson,
} from "../lib/demoData.js";
import { addDays, leagueToday, roundWindow } from "../lib/leagueCalendar.js";
import { seasonDates } from "../lib/leagueSetup.js";
import { computeStandings } from "../lib/leagueStandings.js";
import { advanceTo, bracketRounds, firstRoundSeeds, playoffRoundWindow, seedOrder, type PlayoffRound } from "../lib/playoffs.js";
import { WALKOVER_SCORE } from "../lib/tennisScore.js";
import { ensureDraft, usesWeeklyRounds } from "../services/leagueRounds.js";
import { johnsAccount, Problem } from "./walkthroughData.js";

const quiet = { warn: () => {}, info: () => {} };
const newInviteCode = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);
/** Test League 1: today is the last day of this round, so three weeks of results come before it. */
const CURRENT_ROUND = 4;
const FAR_AWAY_ZIPS = ["11215", "10025", "02139"];

const fullName = (p: Pick<DemoPerson, "firstName" | "lastName">) => `${p.firstName} ${p.lastName}`;

export interface LeagueCounts {
  id: number;
  name: string;
  players: number;
  played: number;
  inGrace: number;
  notPlayed: number;
  johnRecord: { wins: number; losses: number };
}

export interface DemoSummary {
  league: LeagueCounts & { startDate: string; weeks: number; inviteCode: string | null };
  second: LeagueCounts & { waitlist: number };
  past: LeagueCounts & { playoffMatches: number; champion: string; johnSeed: number | null };
  accountsCreated: number;
  leaguePlayers: number;
  nearby: number;
  farAway: number;
  openLeagues: string[];
  joinRequests: number;
  draftRound: number | null;
  johnsMatchToday: { opponent: string; at: string; location: string } | null;
  johnsMatchLater: { opponent: string; at: string; location: string } | null;
  // Kept for the summary's older wording.
  completed: number;
  inGrace: number;
  notPlayed: number;
  johnRecord: { wins: number; losses: number };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

/** Clerk ids for every demo account, creating only the missing ones. */
async function demoClerkIds(people: DemoPerson[]): Promise<{ ids: Map<string, string>; created: number }> {
  const existing = new Map<string, string>();
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerkClient.users.getUserList({ query: DEMO_EMAIL_PREFIX, limit: 100, offset });
    for (const u of data) for (const e of u.emailAddresses) existing.set(e.emailAddress.toLowerCase(), u.id);
    if (data.length < 100) break;
  }
  const ids = new Map<string, string>();
  let created = 0;
  for (const p of people) {
    const email = demoEmail(p);
    let id = existing.get(email);
    if (!id) {
      const user = await clerkClient.users.createUser({
        emailAddress: [email],
        firstName: p.firstName,
        lastName: p.lastName,
        skipPasswordRequirement: true,
        unsafeMetadata: { ageCheck: "passed" },
      });
      id = user.id;
      created++;
    }
    ids.set(email, id);
  }
  return { ids, created };
}

// ─── Finding Test League 1 ───────────────────────────────────────────────────

/** John's league by id, or by name among leagues he runs. Null when there's none yet. */
async function findJohnsLeague(johnId: string, leagueId: number | null, name: string): Promise<League | null> {
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
  return rows[0]?.league ?? null;
}

function checkLeague(league: League) {
  if (league.leagueType !== "singles") throw new Problem(`${league.name} is a doubles league. The demo data fills a singles league.`);
  if (!usesWeeklyRounds(league)) throw new Problem(`${league.name} wasn't set up with the new league form (Flex or Round robin, with a season length).`);
  if (league.seasonWeeks! < CURRENT_ROUND + 1) {
    throw new Problem(`${league.name} is ${league.seasonWeeks} weeks long. Make it at least ${CURRENT_ROUND + 1} weeks so there's history and a next week.`);
  }
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Removes what the last run made: demo leagues, rounds and matches in John's
 * league, and everything the demo accounts have. John's own league row and
 * his place in it stay.
 */
async function reset(leagueId: number | null, johnId: string, demoIds: string[]) {
  const demoLeagues = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.description, DEMO_LEAGUE_MARKER));
  const demoLeagueIds = demoLeagues.map((l) => l.id);
  if (demoLeagueIds.length) {
    // Rounds, byes, invites, admins, join requests and brackets go with the league.
    await db.delete(matchesTable).where(inArray(matchesTable.leagueId, demoLeagueIds));
    await db.delete(playersTable).where(inArray(playersTable.leagueId, demoLeagueIds));
    await db.delete(leaguesTable).where(inArray(leaguesTable.id, demoLeagueIds));
  }

  if (leagueId) {
    // John's league starts over: no rounds, matches or brackets, John at 0 and 0.
    await db.delete(matchesTable).where(eq(matchesTable.leagueId, leagueId));
    await db.delete(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, leagueId)); // byes go with their rounds
    await db.delete(playoffBracketsTable).where(eq(playoffBracketsTable.leagueId, leagueId));
    await db.update(playersTable).set({ wins: 0, losses: 0 }).where(and(eq(playersTable.leagueId, leagueId), eq(playersTable.clerkUserId, johnId)));
  }

  if (!demoIds.length) return;
  await db.delete(leagueJoinRequestsTable).where(inArray(leagueJoinRequestsTable.clerkUserId, demoIds));
  await db.delete(playersTable).where(inArray(playersTable.clerkUserId, demoIds));
  for (const id of demoIds) {
    await deleteAccount(id, quiet, { deleteClerkUser: async () => undefined });
  }
}

// ─── Building blocks ─────────────────────────────────────────────────────────

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

interface Ctx {
  today: string;
  rand: () => number;
  john: { clerkId: string; name: string; rating: number };
  personByName: Map<string, DemoPerson>;
  idOf: (p: DemoPerson) => string;
}

type Outcome = "played" | "retired" | "grace" | "open";
type MatchTime = { date: string; hour: number; minute: number; location: string };

interface SeasonPlan {
  league: League;
  johnPlayerId: number;
  /** The round today falls in, or null when the whole season is in the past. */
  currentRound: number | null;
  /** Rounds to pair and play (later rounds stay unpaired). */
  rounds: number;
  /** John's results in order: true for a win. Repeats if he plays more. */
  johnResults: boolean[];
  /** When John's match in the current round is. */
  johnsCurrentMatch?: MatchTime;
  /** What happened to a match that isn't John's in the current round. */
  outcome: (round: number, othersIndex: number, othersCount: number) => Outcome;
}

interface SeasonResult {
  played: number;
  inGrace: number;
  notPlayed: number;
  johnsCurrent: { opponent: string; at: string; location: string } | null;
}

/** Inserts a league with an owner, an active invite code and its players. Returns the league and the players by Clerk id. */
async function createLeague(
  values: typeof leaguesTable.$inferInsert,
  owner: string,
  members: { name: string; clerkUserId: string; rating: number; hand: string; bio: string | null }[],
) {
  const [league] = await db.insert(leaguesTable).values(values).returning();
  await db.insert(leagueAdminsTable).values({ leagueId: league.id, clerkUserId: owner, role: "owner" });
  await db.insert(leagueInvitesTable).values({ code: newInviteCode(), leagueId: league.id, createdByClerkUserId: owner, isActive: true });
  const players = members.length
    ? await db
        .insert(playersTable)
        .values(members.map((m) => ({ name: m.name, clerkUserId: m.clerkUserId, leagueId: league.id, skillLevel: m.rating.toFixed(1), dominantHand: m.hand, bio: m.bio })))
        .returning()
    : [];
  return { league, players };
}

function memberOf(ctx: Ctx, name: string) {
  const p = ctx.personByName.get(name);
  if (!p) throw new Problem(`Demo data names an unknown player: ${name}`);
  return { name: fullName(p), clerkUserId: ctx.idOf(p), rating: p.rating, hand: p.hand, bio: p.bio };
}

function roundStatus(today: string, start: string, deadline: string) {
  return today > deadline ? "completed" : today >= start ? "active" : "upcoming";
}

/**
 * Pairs and plays a league's rounds with the app's own pairing, then writes
 * results as if players entered them. Rounds are marked sent on their start
 * morning, directly, so nobody gets a push for old rounds.
 */
async function playSeason(ctx: Ctx, plan: SeasonPlan): Promise<SeasonResult> {
  const { league, johnPlayerId, today, rand } = { ...plan, ...ctx };
  const players = await db.select().from(playersTable).where(eq(playersTable.leagueId, league.id));
  const byId = new Map(players.map((p) => [p.id, p]));
  const ratingOf = (id: number) => (id === johnPlayerId ? ctx.john.rating : Number(byId.get(id)?.skillLevel) || 3.5);
  const clerkOf = (id: number) => byId.get(id)?.clerkUserId ?? null;
  const record = new Map<number, { wins: number; losses: number }>();
  const tally = (id: number, won: boolean) => {
    const r = record.get(id) ?? { wins: 0, losses: 0 };
    if (won) r.wins++;
    else r.losses++;
    record.set(id, r);
  };
  const result: SeasonResult = { played: 0, inGrace: 0, notPlayed: 0, johnsCurrent: null };
  let johnGames = 0;

  for (let n = 1; n <= plan.rounds; n++) {
    const w = roundWindow(league.startDate!, n);
    const draft = await ensureDraft(league, n);
    if (!draft) throw new Problem(`Couldn't pair round ${n} of ${league.name}.`);
    const round = draft.round;
    await db
      .update(leagueRoundsTable)
      .set({ publishedAt: new Date(nyTime(w.startDate, 7)), status: roundStatus(today, w.startDate, w.deadline) })
      .where(eq(leagueRoundsTable.id, round.id));

    let matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);
    const isCurrent = n === plan.currentRound;

    // This week, John always has a match: if the pairing gave him the bye, he takes someone's spot.
    if (isCurrent && !matches.some((m) => m.player1Id === johnPlayerId || m.player2Id === johnPlayerId)) {
      const swap = matches[0];
      await db.update(matchesTable).set({ player2Id: johnPlayerId }).where(eq(matchesTable.id, swap.id));
      await db
        .update(leagueRoundByesTable)
        .set({ playerId: swap.player2Id })
        .where(and(eq(leagueRoundByesTable.roundId, round.id), eq(leagueRoundByesTable.playerId, johnPlayerId)));
      matches = await db.select().from(matchesTable).where(eq(matchesTable.roundId, round.id)).orderBy(matchesTable.id);
    }

    const others = matches.filter((m) => m.player1Id !== johnPlayerId && m.player2Id !== johnPlayerId);
    // Days of this round already behind us, for matches played earlier in the week.
    const lastPlayable = w.deadline < today ? w.deadline : addDays(today, -1);
    const daysPlayable = Math.max(1, Math.round((Date.parse(lastPlayable) - Date.parse(w.startDate)) / 86_400_000) + 1);

    for (const m of matches) {
      const hasJohn = m.player1Id === johnPlayerId || m.player2Id === johnPlayerId;
      const location = DEMO_COURTS[Math.floor(rand() * DEMO_COURTS.length)];
      const hour = rand() < 0.35 ? 9 : rand() < 0.5 ? 17 : 18;
      const minute = rand() < 0.5 ? 0 : 30;

      let outcome: Outcome;
      if (hasJohn) outcome = isCurrent ? "open" : "played";
      else outcome = plan.outcome(n, others.indexOf(m), others.length);

      if (outcome === "open") {
        if (isCurrent && hasJohn && plan.johnsCurrentMatch) {
          const t = plan.johnsCurrentMatch;
          const at = nyTime(t.date, t.hour, t.minute);
          await db.update(matchesTable).set({ scheduledAt: at, location: t.location }).where(eq(matchesTable.id, m.id));
          const opp = m.player1Id === johnPlayerId ? m.player2Id : m.player1Id;
          result.johnsCurrent = { opponent: byId.get(opp)?.name ?? "?", at, location: t.location };
        } else if (isCurrent) {
          // Set for later this week (or later today on the last day), or not set yet.
          const room = Math.round((Date.parse(w.deadline) - Date.parse(today)) / 86_400_000);
          const day = room > 0 ? addDays(today, 1 + Math.floor(rand() * room)) : today;
          if (rand() < 0.6) {
            const at = room > 0 ? nyTime(day, hour, minute) : nyTime(day, 19, 30);
            await db.update(matchesTable).set({ scheduledAt: at, location }).where(eq(matchesTable.id, m.id));
          }
        } else {
          result.notPlayed++;
        }
        continue;
      }

      const late = outcome === "grace";
      const day = late ? addDays(w.deadline, 1) : addDays(w.startDate, Math.floor(rand() * daysPlayable));
      const startedAt = nyTime(day, hour, minute);
      const minutes = 70 + Math.floor(rand() * 60);
      const doneAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();

      let score: string;
      let winnerSide: 1 | 2;
      const r1 = ratingOf(m.player1Id);
      const r2 = ratingOf(m.player2Id);
      if (hasJohn) {
        const johnWins = plan.johnResults[johnGames++ % plan.johnResults.length];
        const johnSide = m.player1Id === johnPlayerId ? 1 : 2;
        ({ score, winnerSide } = simulateMatchWon(rand, r1, r2, johnWins ? johnSide : johnSide === 1 ? 2 : 1));
      } else if (outcome === "retired") {
        winnerSide = rand() < setWinChance(r1, r2) ? 1 : 2;
        score = retirementScore(rand, winnerSide);
      } else {
        ({ score, winnerSide } = simulateMatch(rand, r1, r2));
      }
      const winnerId = winnerSide === 1 ? m.player1Id : m.player2Id;
      const loserId = winnerSide === 1 ? m.player2Id : m.player1Id;
      // A retirement is entered by the player who won; otherwise usually the winner.
      const enteredBy = outcome === "retired" || rand() < 0.65 ? winnerId : loserId;
      const enteredByClerk = enteredBy === johnPlayerId ? ctx.john.clerkId : clerkOf(enteredBy);
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
          durationMinutes: outcome === "retired" ? Math.round(minutes / 2) : minutes,
          location,
          inGrace: late,
        })
        .where(eq(matchesTable.id, m.id));
      result.played++;
      if (late) {
        result.inGrace++; // Counts for stats, not standings (decision 25).
      } else {
        tally(winnerId, true);
        tally(loserId, false);
      }
    }
  }

  // Each player's league record, as scoring keeps it.
  for (const [playerId, r] of record) {
    await db.update(playersTable).set({ wins: r.wins, losses: r.losses }).where(eq(playersTable.id, playerId));
  }
  return result;
}

async function recordOf(playerId: number) {
  const [p] = await db.select({ wins: playersTable.wins, losses: playersTable.losses }).from(playersTable).where(eq(playersTable.id, playerId));
  return p ?? { wins: 0, losses: 0 };
}

/**
 * A finished playoff for a past league, seeded from its final standings the
 * way the app seeds it. Written directly, so nobody gets "You made the
 * playoffs" for an old season. One first-round match is a walkover; John (if
 * he made it) wins his first match and loses the next.
 */
async function playPlayoffs(ctx: Ctx, league: League, johnPlayerId: number) {
  const size = league.playoffSize >= 8 ? 8 : 4;
  const [players, matches] = await Promise.all([
    db.select().from(playersTable).where(eq(playersTable.leagueId, league.id)),
    db.select().from(matchesTable).where(eq(matchesTable.leagueId, league.id)),
  ]);
  const seeded = seedOrder(computeStandings(players, matches), matches).slice(0, size);
  const seedings: PlayoffSeeding[] = seeded.map((s, i) => ({ seed: i + 1, playerId: s.playerId, playerName: s.playerName, winRate: s.winRate }));
  const ratingOf = (id: number) => (id === johnPlayerId ? ctx.john.rating : Number(players.find((p) => p.id === id)?.skillLevel) || 3.5);
  const clerkOf = (id: number) => (id === johnPlayerId ? ctx.john.clerkId : players.find((p) => p.id === id)?.clerkUserId ?? null);

  const rounds = bracketRounds(size);
  const [bracket] = await db
    .insert(playoffBracketsTable)
    .values({ leagueId: league.id, status: "completed", seedings, generatedAt: new Date(nyTime(playoffRoundWindow({ startDate: league.startDate!, seasonWeeks: league.seasonWeeks! }, size, rounds[0])!.startDate, 7)) })
    .returning();

  const bySeed = (n: number) => seedings.find((s) => s.seed === n)!.playerId;
  let current: [number, number][] = firstRoundSeeds(size).map(([a, b]) => [bySeed(a), bySeed(b)]);
  // The walkover: a first-round match without John.
  const walkoverSlot = [3, 2, 4, 1].find((slot) => slot <= current.length && !current[slot - 1].includes(johnPlayerId)) ?? 0;
  let champion = 0;
  let count = 0;

  for (const [ri, round] of rounds.entries()) {
    const window = playoffRoundWindow({ startDate: league.startDate!, seasonWeeks: league.seasonWeeks! }, size, round as PlayoffRound)!;
    const winners: number[] = [];
    for (const [i, [p1, p2]] of current.entries()) {
      const slot = i + 1;
      const day = addDays(window.startDate, 2 + Math.floor(ctx.rand() * 9));
      const startedAt = nyTime(day, ctx.rand() < 0.5 ? 10 : 17, 0);
      let values: Partial<typeof matchesTable.$inferInsert>;
      let winnerId: number;
      if (ri === 0 && slot === walkoverSlot) {
        winnerId = ratingOf(p1) >= ratingOf(p2) ? p1 : p2;
        const at = nyTime(window.playBy, 20);
        values = { score: WALKOVER_SCORE, completedAt: at, recordedAt: at, recordedByClerkUserId: league.createdByClerkUserId };
      } else {
        let sim: { score: string; winnerSide: 1 | 2 };
        if (p1 === johnPlayerId || p2 === johnPlayerId) {
          const johnSide = p1 === johnPlayerId ? 1 : 2;
          const johnWins = ri === 0; // wins his first playoff match, then goes out
          sim = simulateMatchWon(ctx.rand, ratingOf(p1), ratingOf(p2), johnWins ? johnSide : johnSide === 1 ? 2 : 1);
        } else if (round === "final") {
          // Finals tend to be close: look for one that went to a match tiebreak.
          sim = simulateMatch(ctx.rand, ratingOf(p1), ratingOf(p2));
          for (let k = 0; k < 30 && !hasMatchTiebreak(sim.score); k++) sim = simulateMatch(ctx.rand, ratingOf(p1), ratingOf(p2));
        } else {
          sim = simulateMatch(ctx.rand, ratingOf(p1), ratingOf(p2));
        }
        winnerId = sim.winnerSide === 1 ? p1 : p2;
        const minutes = 80 + Math.floor(ctx.rand() * 60);
        const doneAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
        values = {
          score: sim.score,
          scheduledAt: startedAt,
          startedAt,
          completedAt: doneAt,
          recordedAt: doneAt,
          durationMinutes: minutes,
          location: league.location,
          recordedByClerkUserId: clerkOf(winnerId),
        };
      }
      await db.insert(matchesTable).values({
        leagueId: league.id,
        player1Id: p1,
        player2Id: p2,
        status: "completed",
        winnerId,
        inGrace: false,
        generatedFrom: "playoff",
        playoffBracketId: bracket.id,
        playoffRound: round,
        playoffSlot: slot,
        ...values,
      });
      count++;
      winners.push(winnerId);
    }
    if (winners.length === 1) {
      champion = winners[0];
      break;
    }
    // Winners meet in the next round's slots, the same way the app moves them on.
    const next: [number, number][] = [];
    winners.forEach((id, i) => {
      const to = advanceTo(i + 1);
      next[to.slot - 1] ??= [0, 0];
      next[to.slot - 1][to.position - 1] = id;
    });
    current = next;
  }

  const johnSeed = seedings.find((s) => s.playerId === johnPlayerId)?.seed ?? null;
  const championName = champion === johnPlayerId ? ctx.john.name : players.find((p) => p.id === champion)?.name ?? "?";
  return { matches: count, champion: championName, johnSeed };
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export async function seedDemo(opts: { me: string | null; leagueId: number | null; name: string }): Promise<DemoSummary> {
  const john = await johnsAccount(opts.me);
  const found = await findJohnsLeague(john.id, opts.leagueId, opts.name);
  if (found) checkLeague(found);
  const [johnUser] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, john.id));
  const johnRating = johnUser?.rating ?? 3.5;
  const johnName = johnUser?.displayName ?? john.name;

  const everyone = [...DEMO_LEAGUE_PLAYERS, ...DEMO_NEARBY_PLAYERS];
  const { ids, created: accountsCreated } = await demoClerkIds(everyone);
  const idOf = (p: DemoPerson) => ids.get(demoEmail(p))!;
  await reset(found?.id ?? null, john.id, [...ids.values()]);

  // Profiles: onboarding done, so each lands on the tabs if you sign in as them.
  for (const p of DEMO_LEAGUE_PLAYERS) await insertProfile(p, idOf(p), "join_league");
  for (const p of DEMO_NEARBY_PLAYERS) await insertProfile(p, idOf(p), "find_matches");
  // Nearby players get a player profile too, so they can be messaged and reported.
  await db.insert(playersTable).values(DEMO_NEARBY_PLAYERS.map((p) => ({ name: fullName(p), clerkUserId: idOf(p), skillLevel: p.rating.toFixed(1), dominantHand: p.hand, bio: p.bio })));

  const today = leagueToday();
  const ctx: Ctx = {
    today,
    rand: seededRandom(20261107),
    john: { clerkId: john.id, name: johnName, rating: johnRating },
    personByName: new Map(everyone.map((p) => [fullName(p), p])),
    idOf,
  };

  // ── Test League 1: today is the last day of week 4, so round 5 goes out tomorrow.
  const startDate = startForDeadlineDay(today, CURRENT_ROUND);
  let league: League;
  if (found) {
    [league] = await db
      .update(leaguesTable)
      .set({ startDate, endDate: seasonDates(startDate, found.seasonWeeks!).endDate, status: "active", endedAt: null, location: found.location ?? DEMO_COURTS[0] })
      .where(eq(leaguesTable.id, found.id))
      .returning();
  } else {
    // No Test League 1 yet (a fresh staging database): make it the way the new league form does.
    ({ league } = await createLeague(
      {
        name: opts.name,
        format: "flex",
        status: "active",
        leagueType: "singles",
        visibility: "private",
        startDate,
        endDate: seasonDates(startDate, 8).endDate,
        seasonWeeks: 8,
        playoffSize: 4,
        location: DEMO_COURTS[0],
        createdByClerkUserId: john.id,
      },
      john.id,
      [],
    ));
  }
  let [johnPlayer] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.leagueId, league.id), eq(playersTable.clerkUserId, john.id), isNull(playersTable.leftAt)));
  if (!johnPlayer) {
    [johnPlayer] = await db
      .insert(playersTable)
      .values({ name: johnName, clerkUserId: john.id, leagueId: league.id, skillLevel: johnRating.toFixed(1), dominantHand: johnUser?.dominantHand ?? "right" })
      .returning();
  }
  // The 12 join, as if they used the invite before the season started.
  await db
    .insert(playersTable)
    .values(DEMO_LEAGUE_PLAYERS.map((p) => ({ name: fullName(p), clerkUserId: idOf(p), leagueId: league.id, skillLevel: p.rating.toFixed(1), dominantHand: p.hand, bio: p.bio })));

  const tl1 = await playSeason(ctx, {
    league,
    johnPlayerId: johnPlayer.id,
    currentRound: CURRENT_ROUND,
    rounds: CURRENT_ROUND,
    johnResults: [true, false, true],
    johnsCurrentMatch: { date: today, hour: 18, minute: 30, location: DEMO_COURTS[0] },
    outcome: (n, i, count) => {
      if (n === CURRENT_ROUND) return i % 3 === 1 ? "played" : "open"; // a few played earlier this week
      if (n === CURRENT_ROUND - 1) return i === count - 1 ? "open" : i === count - 2 ? "grace" : "played"; // grace week ends today
      if (n === 2) return i === count - 1 ? "open" : i === 0 ? "retired" : "played"; // one never played, one retirement
      return "played";
    },
  });
  // Round 5 goes out tomorrow morning: its pairings wait for John's review in Manage.
  const draft = league.seasonWeeks! > CURRENT_ROUND ? await ensureDraft(league, CURRENT_ROUND + 1) : null;

  // Olivia asked to join after the season started: a Private league asks the organizer (decision 30).
  const asker = ctx.personByName.get(DEMO_JOIN_REQUEST)!;
  await db.insert(leagueJoinRequestsTable).values({
    leagueId: league.id,
    clerkUserId: idOf(asker),
    playerName: fullName(asker),
    skillLevel: asker.rating.toFixed(1),
    kind: "request",
    status: "pending",
    createdAt: new Date(nyTime(addDays(today, -1), 20, 15)),
  });

  // ── Dutchess County Singles: Open, run by John, full, today is day 2 of week 3.
  const s = DEMO_SECOND_LEAGUE;
  const secondStart = startForRoundDay(today, s.currentRound, 2);
  const { league: second, players: secondPlayers } = await createLeague(
    {
      name: s.name,
      description: DEMO_LEAGUE_MARKER,
      format: s.format,
      status: "active",
      leagueType: "singles",
      visibility: "open",
      minRating: s.minRating,
      maxRating: s.maxRating,
      rosterCap: s.rosterCap,
      startDate: secondStart,
      endDate: seasonDates(secondStart, s.weeks).endDate,
      seasonWeeks: s.weeks,
      playoffSize: s.playoffSize,
      location: s.location,
      createdByClerkUserId: john.id,
    },
    john.id,
    [
      { name: johnName, clerkUserId: john.id, rating: johnRating, hand: johnUser?.dominantHand ?? "right", bio: null },
      ...s.members.map((n) => memberOf(ctx, n)),
    ],
  );
  const johnInSecond = secondPlayers.find((p) => p.clerkUserId === john.id)!;
  const dutchess = await playSeason(ctx, {
    league: second,
    johnPlayerId: johnInSecond.id,
    currentRound: s.currentRound,
    rounds: s.currentRound,
    johnResults: [false, true],
    johnsCurrentMatch: { date: addDays(today, 3), hour: 19, minute: 0, location: s.location },
    outcome: (n, i, count) => {
      if (n === s.currentRound) return i === 0 ? "played" : "open"; // one played yesterday
      if (n === s.currentRound - 1) return i === count - 1 ? "grace" : "played"; // deadline was two days ago
      return i === count - 1 ? "open" : "played"; // one never played
    },
  });
  // The season started and the roster is full, so new requests wait for next season.
  for (const [k, name] of s.waitlist.entries()) {
    const p = ctx.personByName.get(name)!;
    await db.insert(leagueJoinRequestsTable).values({
      leagueId: second.id,
      clerkUserId: idOf(p),
      playerName: fullName(p),
      skillLevel: p.rating.toFixed(1),
      kind: "waitlist",
      status: "pending",
      createdAt: new Date(nyTime(addDays(today, -6 + k * 2), 12 + k, 10)),
    });
  }

  // ── Hudson Valley Summer Singles: over a few weeks ago, playoffs and all.
  const pl = DEMO_PAST_LEAGUE;
  const finalPlayBy = addDays(today, -pl.endedDaysAgo);
  // Playoffs start the day after week 8's deadline; three two-week rounds for a top 8.
  const pastStart = addDays(finalPlayBy, -(pl.weeks * 7 + 3 * 14 - 1));
  const organizer = memberOf(ctx, pl.organizer);
  const { league: past, players: pastPlayers } = await createLeague(
    {
      name: pl.name,
      description: DEMO_LEAGUE_MARKER,
      format: pl.format,
      status: "completed",
      leagueType: "singles",
      visibility: "private",
      startDate: pastStart,
      endDate: seasonDates(pastStart, pl.weeks).endDate,
      seasonWeeks: pl.weeks,
      playoffSize: pl.playoffSize,
      location: pl.location,
      createdByClerkUserId: organizer.clerkUserId,
    },
    organizer.clerkUserId,
    [
      organizer,
      { name: johnName, clerkUserId: john.id, rating: johnRating, hand: johnUser?.dominantHand ?? "right", bio: null },
      ...pl.members.map((n) => memberOf(ctx, n)),
    ],
  );
  const johnInPast = pastPlayers.find((p) => p.clerkUserId === john.id)!;
  const summer = await playSeason(ctx, {
    league: past,
    johnPlayerId: johnInPast.id,
    currentRound: null,
    rounds: pl.weeks,
    johnResults: [true, true, false, true, false, true, true, false],
    outcome: (n, i, count) => (n === 5 && i === 0 ? "retired" : n === 3 && i === count - 1 ? "open" : n === 7 && i === 1 ? "grace" : "played"),
  });
  const playoffs = await playPlayoffs(ctx, past, johnInPast.id);

  // ── Two Open leagues nearby, starting soon, run by demo players.
  for (const o of DEMO_OPEN_LEAGUES) {
    const start = addDays(today, o.startsInDays);
    const owner = memberOf(ctx, o.organizer);
    await createLeague(
      {
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
        createdByClerkUserId: owner.clerkUserId,
      },
      owner.clerkUserId,
      [owner, ...o.members.map((n) => memberOf(ctx, n))],
    );
  }

  const [invite] = await db
    .select({ code: leagueInvitesTable.code })
    .from(leagueInvitesTable)
    .where(and(eq(leagueInvitesTable.leagueId, league.id), eq(leagueInvitesTable.isActive, true)))
    .limit(1);
  const farAway = DEMO_NEARBY_PLAYERS.filter((p) => FAR_AWAY_ZIPS.includes(p.zip)).length;
  const johnRecord = await recordOf(johnPlayer.id);

  return {
    league: {
      id: league.id,
      name: league.name,
      players: DEMO_LEAGUE_PLAYERS.length + 1,
      played: tl1.played,
      inGrace: tl1.inGrace,
      notPlayed: tl1.notPlayed,
      johnRecord,
      startDate,
      weeks: league.seasonWeeks!,
      inviteCode: invite?.code ?? null,
    },
    second: {
      id: second.id,
      name: second.name,
      players: secondPlayers.length,
      played: dutchess.played,
      inGrace: dutchess.inGrace,
      notPlayed: dutchess.notPlayed,
      johnRecord: await recordOf(johnInSecond.id),
      waitlist: s.waitlist.length,
    },
    past: {
      id: past.id,
      name: past.name,
      players: pastPlayers.length,
      played: summer.played,
      inGrace: summer.inGrace,
      notPlayed: summer.notPlayed,
      johnRecord: await recordOf(johnInPast.id),
      playoffMatches: playoffs.matches,
      champion: playoffs.champion,
      johnSeed: playoffs.johnSeed,
    },
    accountsCreated,
    leaguePlayers: DEMO_LEAGUE_PLAYERS.length,
    nearby: DEMO_NEARBY_PLAYERS.length - farAway,
    farAway,
    openLeagues: DEMO_OPEN_LEAGUES.map((o) => o.name),
    joinRequests: 1,
    draftRound: draft ? draft.round.roundNumber : null,
    johnsMatchToday: tl1.johnsCurrent,
    johnsMatchLater: dutchess.johnsCurrent,
    completed: tl1.played,
    inGrace: tl1.inGrace,
    notPlayed: tl1.notPlayed,
    johnRecord,
  };
}
