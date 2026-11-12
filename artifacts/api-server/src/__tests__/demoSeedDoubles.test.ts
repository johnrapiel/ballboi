// The doubles demo data (src/dev/demoDoubles.ts).
//
// The first block is pure and always runs. The second runs the whole demo
// seed twice against a real, empty Postgres and checks the second run gives
// the same leagues. It needs a database, so it only runs when
// DEMO_SEED_DATABASE_URL is set (never in CI). Clerk and push are faked.
//
//   pnpm db:up && pnpm db:push
//   DEMO_SEED_DATABASE_URL=postgres://... pnpm --filter @workspace/api-server exec vitest run src/__tests__/demoSeedDoubles.test.ts

import { describe, expect, it, vi } from "vitest";
import { DEMO_DOUBLES, doublesDemoNames, tuesdaySeasonStart, DOUBLES_CURRENT_ROUND } from "../dev/demoDoubles.js";
import { demoPeople } from "../lib/demoData.js";
import { roundWindow } from "../lib/leagueCalendar.js";

// Runs before the imports above, so @workspace/db connects to the test database.
const dbUrl = vi.hoisted(() => {
  const url = process.env.DEMO_SEED_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return url;
});

// ── Fakes for the database run ─────────────────────────────────────────────

const pushes: unknown[][] = [];
vi.mock("../routes/notifications.js", () => ({
  sendPushToUsers: async (...args: unknown[]) => {
    pushes.push(args);
  },
}));

const clerkUsers: { id: string; email: string; firstName: string; lastName: string }[] = [
  { id: "user_john", email: "john@example.com", firstName: "John", lastName: "Rapiel" },
];
vi.mock("@clerk/express", () => {
  const view = (u: (typeof clerkUsers)[number]) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, emailAddresses: [{ emailAddress: u.email }] });
  return {
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: null }),
    clerkClient: {
      users: {
        getUserList: async (q: { query?: string; emailAddress?: string[]; offset?: number }) => {
          if (q.offset) return { data: [] };
          const found = q.emailAddress
            ? clerkUsers.filter((u) => q.emailAddress!.includes(u.email))
            : clerkUsers.filter((u) => u.email.includes(q.query ?? ""));
          return { data: found.map(view) };
        },
        createUser: async (u: { emailAddress: string[]; firstName: string; lastName: string }) => {
          const made = { id: `user_${clerkUsers.length}`, email: u.emailAddress[0], firstName: u.firstName, lastName: u.lastName };
          clerkUsers.push(made);
          return view(made);
        },
        updateUserMetadata: async () => ({}),
        deleteUser: async () => ({}),
      },
    },
  };
});

// ── Pure ───────────────────────────────────────────────────────────────────

describe("doubles demo data", () => {
  it("only names players the staging seed already makes", () => {
    const made = new Set(demoPeople(false).map((p) => `${p.firstName} ${p.lastName}`));
    for (const n of doublesDemoNames()) expect(made.has(n), n).toBe(true);
  });

  it("has nobody twice in one league", () => {
    const d = DEMO_DOUBLES;
    const fixed = [d.fixed.johnsPartner, ...d.fixed.teams.flat(), d.fixed.looking];
    const upcoming = [...d.upcoming.team, d.upcoming.asksJohn, d.upcoming.looking, d.upcoming.noPartner];
    for (const list of [fixed, [...d.rotating.members], upcoming]) expect(new Set(list).size).toBe(list.length);
    expect(fixed).toHaveLength(8); // 9 with John: 4 teams and one looking
    expect(d.rotating.members).toHaveLength(8); // 9 with John: one bye a week
  });

  it("puts this week's Tuesday match today or later, inside week 3", () => {
    for (let k = 0; k < 7; k++) {
      const today = new Date(Date.UTC(2026, 10, 12 + k)).toISOString().slice(0, 10);
      const w = roundWindow(tuesdaySeasonStart(today), DOUBLES_CURRENT_ROUND);
      expect(w.startDate <= today && today <= w.deadline, today).toBe(true);
      expect(new Date(`${w.deadline}T00:00:00Z`).getUTCDay()).toBe(2); // the week ends on Tuesday
    }
  });
});

// ── The whole seed, twice, on a real database ──────────────────────────────

describe.skipIf(!dbUrl)("demo seed on a database", () => {
  it("runs twice and gives the same leagues", { timeout: 120_000 }, async () => {
    process.env.ADMIN_EMAIL = "john@example.com";
    const { seedDemo } = await import("../dev/demoSeed.js");
    const dbm = await import("@workspace/db");
    const { db, leaguesTable, leagueTeamsTable, leaguePartnerRequestsTable, matchesTable, playersTable, messageGroupsTable, messageGroupMembersTable, leagueRoundByesTable, leagueRoundsTable } = dbm;
    const { eq, and, inArray, isNull } = await import("drizzle-orm");
    const { computeStandings, computeTeamStandings } = await import("../lib/leagueStandings.js");
    const { DEMO_LEAGUE_MARKER } = await import("../lib/demoData.js");

    /** What John sees in each doubles league, without database ids. */
    async function picture(summary: Awaited<ReturnType<typeof seedDemo>>) {
      const d = summary.doubles;
      const out: Record<string, unknown> = {};
      for (const league of [d.fixed, d.rotating, d.upcoming]) {
        const [players, matches, teams, requests, rounds] = await Promise.all([
          db.select().from(playersTable).where(eq(playersTable.leagueId, league.id)),
          db.select().from(matchesTable).where(eq(matchesTable.leagueId, league.id)).orderBy(matchesTable.id),
          db.select().from(leagueTeamsTable).where(and(eq(leagueTeamsTable.leagueId, league.id), isNull(leagueTeamsTable.dissolvedAt))),
          db.select().from(leaguePartnerRequestsTable).where(eq(leaguePartnerRequestsTable.leagueId, league.id)),
          db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.leagueId, league.id)),
        ]);
        const name = new Map(players.map((p) => [p.id, p.name]));
        const byes = rounds.length
          ? await db.select().from(leagueRoundByesTable).where(inArray(leagueRoundByesTable.roundId, rounds.map((r) => r.id)))
          : [];
        const standings =
          league === d.fixed
            ? computeTeamStandings(teams.map((t) => ({ id: t.id, playerIds: [t.player1Id, t.player2Id] as [number, number] })), name, matches)
            : computeStandings(players, matches);
        out[league.name] = {
          players: players.map((p) => `${p.name} ${p.wins}-${p.losses}${p.lookingForPartnerAt ? " looking" : ""}`).sort(),
          teams: teams.map((t) => [name.get(t.player1Id), name.get(t.player2Id)].sort().join(" & ")).sort(),
          requests: requests.map((r) => `${name.get(r.fromPlayerId)} > ${name.get(r.toPlayerId)} ${r.status}`).sort(),
          rounds: rounds.map((r) => `${r.roundNumber} ${r.status} ${r.publishedAt ? "out" : "draft"}`).sort(),
          byes: byes.length,
          matches: matches.map((m) => `${[m.player1Id, m.player3Id].map((id) => name.get(id!)).join("/")} v ${[m.player2Id, m.player4Id].map((id) => name.get(id!)).join("/")} ${m.status} ${m.score ?? ""} ${m.scheduledAt ? "timed" : ""}`),
          standings: standings.map((s) => `${s.rank}. ${s.playerName} ${s.wins}-${s.losses}`),
        };
      }
      return out;
    }

    const first = await seedDemo({ me: null, leagueId: null, name: "Test League 1" });
    const before = await picture(first);

    // John opened his Tuesday match's chat in the app since then: the next run closes it.
    const [johnsMatch] = await db
      .select()
      .from(matchesTable)
      .where(and(eq(matchesTable.leagueId, first.doubles.fixed.id), eq(matchesTable.status, "scheduled")));
    const [chat] = await db.insert(messageGroupsTable).values({ channelId: `test-match-${johnsMatch.id}`, matchId: johnsMatch.id, title: "Doubles · Week 3" }).returning();
    await db.insert(messageGroupMembersTable).values({ groupId: chat.id, clerkUserId: "user_john" });

    const second = await seedDemo({ me: null, leagueId: null, name: "Test League 1" });
    const after = await picture(second);

    expect(after).toEqual(before);
    expect(second.doubles).toMatchObject({ ...first.doubles, fixed: { ...first.doubles.fixed, id: second.doubles.fixed.id }, rotating: { ...first.doubles.rotating, id: second.doubles.rotating.id }, upcoming: { ...first.doubles.upcoming, id: second.doubles.upcoming.id } });

    // Last run's leagues are gone, not doubled up: 2 singles + 3 doubles demo leagues, plus Test League 1.
    const demoLeagues = await db.select().from(leaguesTable).where(eq(leaguesTable.description, DEMO_LEAGUE_MARKER));
    expect(demoLeagues.map((l) => l.name).sort()).toEqual(["Dutchess County Singles", "Hudson Valley Summer Singles", "Rotating Doubles Night", "Tuesday Doubles", "Winter Doubles"]);
    expect(await db.select().from(messageGroupMembersTable).where(eq(messageGroupMembersTable.groupId, chat.id))).toHaveLength(0);
    const [closed] = await db.select().from(messageGroupsTable).where(eq(messageGroupsTable.id, chat.id));
    expect(closed.open).toBe(false);

    // What John sees.
    const d = second.doubles;
    expect(d.fixed).toMatchObject({ players: 9, teams: 4, looking: 1, played: 4 });
    expect(d.fixed.johnsMatch?.partner).toBe("Maya Chen");
    expect(d.fixed.johnsMatch?.at).toBeTruthy();
    expect(d.fixed.johnsTeamRecord).toEqual({ wins: 1, losses: 1 });
    expect(d.rotating).toMatchObject({ players: 9, played: 4, byesThisWeek: 1 });
    expect(d.rotating.johnsMatch?.opponents).toHaveLength(2);
    expect(d.upcoming).toMatchObject({ players: 6, teams: 1, withoutPartner: 4, requestsToJohn: 1, looking: 1 });
    const fixedPicture = after["Tuesday Doubles"] as { standings: string[]; teams: string[] };
    expect(fixedPicture.standings).toHaveLength(4);
    expect(fixedPicture.teams).toContain("John Rapiel & Maya Chen");
    expect((after["Rotating Doubles Night"] as { standings: string[] }).standings).toHaveLength(9);
    // Nobody got a push from the seed.
    expect(pushes).toHaveLength(0);

    // The workflow's log: numbers only, no names.
    const { demoCounts } = await import("../dev/walkthroughCommands.js");
    const counts = demoCounts(second);
    expect(counts).toContain("Fixed doubles league: 9 players, 4 teams, 1 looking for a partner, 4 played; your team's match this week: yes");
    expect(counts).toContain("Rotating doubles league: 9 players, 4 played, 1 bye this week; your match this week: yes");
    expect(counts).toContain("Upcoming doubles league: 6 players, 1 team, 4 without a partner (you included), 1 looking for a partner, 1 team-up request to you");
    for (const n of ["Maya", "Tuesday", "Rotating Doubles", "Winter"]) expect(counts).not.toContain(n);
  });
});
