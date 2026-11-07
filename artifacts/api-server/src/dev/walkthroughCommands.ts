// The walkthrough commands (development only). Entry point: walkthrough.ts.

import { clerkClient } from "@clerk/express";
import { db, leaguesTable, matchesTable, playersTable, pool } from "@workspace/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { devToolsAllowed, type TimeAction } from "../lib/devTime.js";
import { shortDate } from "../lib/leagueCalendar.js";
import {
  HELP,
  parseCommand,
  SEEDED_LEAGUE_NAME,
  SEEDED_LETTERS,
  TEST_EMAIL_CODE,
  WALKTHROUGH_ACCOUNTS,
  type Command,
} from "../lib/walkthrough.js";
import { applyTimeAction, pairNow } from "../services/devLeagueTime.js";
import { fullName, idFor, Problem, seed, seededIds, seededLeague } from "./walkthroughData.js";
import { seedDemo, type DemoSummary } from "./demoSeed.js";


// ─── Acting as B, C or D ─────────────────────────────────────────────────────

/** A short-lived session token for a seeded account (Clerk development instances only). */
async function tokenFor(clerkUserId: string): Promise<string> {
  const session = await clerkClient.sessions.createSession({ userId: clerkUserId });
  const token = await clerkClient.sessions.getToken(session.id);
  return token.jwt;
}

async function api<T = unknown>(as: string, method: string, path: string, body?: unknown): Promise<T> {
  const API = process.env.WALKTHROUGH_API_URL ?? `http://localhost:${process.env.API_PORT ?? "8080"}/api`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await tokenFor(as)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Problem(`Can't reach the API at ${API}. Start it with: pnpm dev`);
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new Problem(`${res.status}: ${data?.error ?? data?.message ?? res.statusText}`);
  return data as T;
}

/** A player row for an account, preferring one still in a league. */
async function playerIdFor(clerkUserId: string): Promise<number> {
  const rows = await db.select().from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId)).orderBy(desc(playersTable.id));
  const pick = rows.find((p) => !p.leftAt && p.leagueId) ?? rows.find((p) => !p.leftAt) ?? rows[0];
  if (!pick) throw new Problem("That account has no player profile yet. Run: pnpm seed:walkthrough");
  return pick.id;
}

async function message(c: Extract<Command, { kind: "message" }>) {
  const from = await idFor(c.as);
  const to = await playerIdFor(await idFor(c.to));
  const result = await api<{ conversationId?: number }>(from, "POST", "/messages", {
    playerId: to,
    text: c.text,
    clientMessageId: `walkthrough-${Date.now()}`,
  });
  console.log(`${c.as} sent "${c.text}" to ${c.to} (conversation ${result.conversationId ?? "?"}).`);
}

async function join(c: Extract<Command, { kind: "join" }>) {
  const as = await idFor(c.as);
  const result = await api<{ message?: string }>(as, "POST", `/invites/${encodeURIComponent(c.code)}/join`, {
    playerName: fullName(c.as),
    skillLevel: WALKTHROUGH_ACCOUNTS[c.as].rating.toFixed(1),
  });
  console.log(`${c.as}: ${result.message ?? "done"}`);
}

async function report(c: Extract<Command, { kind: "report" }>) {
  const as = await idFor(c.as);
  const aboutPlayer = await playerIdFor(await idFor(c.about));
  // The app reports the message itself when there's a conversation, else the player.
  const { conversationId } = await api<{ conversationId: number | null }>(as, "GET", `/messages/with-player/${aboutPlayer}`);
  if (conversationId) {
    const thread = await api<{ messages: { id: string; fromMe: boolean; text: string }[] }>(as, "GET", `/messages/${conversationId}`);
    const theirs = thread.messages.filter((m) => !m.fromMe).pop();
    if (theirs) {
      await api(as, "POST", `/messages/${conversationId}/report`, { messageId: theirs.id, reason: c.reason });
      console.log(`${c.as} reported ${c.about}'s message "${theirs.text}" (${c.reason}).`);
      return;
    }
  }
  await api(as, "POST", "/reports", { targetType: "player", targetId: String(aboutPlayer), reason: c.reason });
  console.log(`${c.as} reported ${c.about}'s profile (${c.reason}).`);
}

async function score(c: Extract<Command, { kind: "score" }>) {
  const as = await idFor(c.as);
  let matchId = c.matchId;
  let leagueId: number | null = null;
  if (matchId === null) {
    // Their most recent match against John.
    const john = await idFor("A");
    const mine = (await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, as))).map((p) => p.id);
    const johns = (await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.clerkUserId, john))).map((p) => p.id);
    if (!mine.length || !johns.length) throw new Problem(`${c.as} has no match with A. Pass --match <id>.`);
    const [m] = await db
      .select()
      .from(matchesTable)
      .where(and(
        isNull(matchesTable.voidedAt),
        or(
          and(inArray(matchesTable.player1Id, mine), inArray(matchesTable.player2Id, johns)),
          and(inArray(matchesTable.player1Id, johns), inArray(matchesTable.player2Id, mine)),
        ),
      ))
      .orderBy(desc(matchesTable.id))
      .limit(1);
    if (!m) throw new Problem(`${c.as} has no match with A. Pass --match <id>.`);
    matchId = m.id;
    leagueId = m.leagueId;
  } else {
    const [m] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
    if (!m) throw new Problem(`No match ${matchId}.`);
    leagueId = m.leagueId;
  }
  if (!leagueId) throw new Problem("That match isn't in a league.");
  const result = await api<{ score: string; inGrace: boolean }>(as, "POST", `/leagues/${leagueId}/matches/${matchId}/score`, { score: c.score });
  console.log(`${c.as} entered ${c.score} for match ${matchId}. Stored as ${result.score}${result.inGrace ? " (grace week: not in standings)" : ""}.`);
}

async function leave(c: Extract<Command, { kind: "leave" }>) {
  const as = await idFor(c.as);
  let leagueId = c.leagueId;
  if (leagueId === null) {
    const rows = await db
      .select({ leagueId: playersTable.leagueId, name: leaguesTable.name })
      .from(playersTable)
      .innerJoin(leaguesTable, eq(leaguesTable.id, playersTable.leagueId))
      .where(and(eq(playersTable.clerkUserId, as), isNull(playersTable.leftAt)));
    if (rows.length !== 1) {
      throw new Problem(
        rows.length ? `${c.as} is in ${rows.map((r) => `${r.name} (${r.leagueId})`).join(", ")}. Pass a league id.` : `${c.as} isn't in a league.`,
      );
    }
    leagueId = rows[0].leagueId!;
  }
  const result = await api<{ voidedMatches: number }>(as, "POST", `/leagues/${leagueId}/leave`);
  console.log(`${c.as} left league ${leagueId}. ${result.voidedMatches} remaining match(es) cancelled.`);
}

// ─── Time controls ───────────────────────────────────────────────────────────

async function leagueIdFrom(arg: "seeded" | number): Promise<number> {
  if (arg !== "seeded") return arg;
  const league = await seededLeague();
  if (!league) throw new Problem("No seeded league. Run: pnpm seed:walkthrough");
  return league.id;
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/** The seed only writes rows. If the tables aren't there, stop before touching anything. */
async function checkTables() {
  const needed = ["users", "leagues", "players", "matches", "league_rounds", "league_join_requests", "playoff_brackets", "schema_migrations"];
  const { rows } = await pool.query<{ name: string; found: string | null }>(
    "SELECT name, to_regclass('public.' || name)::text AS found FROM unnest($1::text[]) AS name",
    [needed],
  );
  const missing = rows.filter((r) => !r.found).map((r) => r.name);
  if (missing.length) {
    throw new Problem(`The database is missing tables (${missing.join(", ")}). Set it up first (pnpm db:push locally; on staging, deploy the API). Nothing was changed.`);
  }
}

/** Numbers only, for a shared log (the staging seed in GitHub Actions). */
export function demoCounts(d: DemoSummary): string {
  return [
    "Demo data is ready.",
    `Demo accounts: ${d.leaguePlayers + d.nearby + d.farAway} (${d.accountsCreated} new in Clerk)`,
    `Test League 1: ${d.league.players} players, ${d.league.played} played, ${d.league.inGrace} in grace week, ${d.league.notPlayed} not played; match today: ${d.johnsMatchToday ? "yes" : "no"}; round ${d.draftRound ?? "-"} draft for review; ${d.joinRequests} join request`,
    `Second league: ${d.second.players} players, ${d.second.played} played, ${d.second.inGrace} in grace week, ${d.second.notPlayed} not played; match later this week: ${d.johnsMatchLater ? "yes" : "no"}; ${d.second.waitlist} on the waitlist`,
    `Past league: ${d.past.players} players, ${d.past.played} played, ${d.past.playoffMatches} playoff matches`,
    `Discover: ${d.nearby} nearby, ${d.farAway} far away; ${d.openLeagues.length} Open leagues starting soon`,
  ].join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

/** Runs one walkthrough command. Returns the process exit code. */
export async function runCommand(argv: string[]): Promise<number> {
  if (!devToolsAllowed()) {
    console.error("Walkthrough tools are for development only (NODE_ENV is production, or the Clerk key is live).");
    return 1;
  }
  const cmd = parseCommand(argv);
  if ("error" in cmd) {
    console.error(cmd.error);
    return 1;
  }
  const needsClerk = !["help", "time", "pair-now"].includes(cmd.kind);
  if (needsClerk && !process.env.CLERK_SECRET_KEY) {
    console.error("Add your Clerk development secret key to .env as CLERK_SECRET_KEY (see .env.example).");
    return 1;
  }
  switch (cmd.kind) {
    case "help":
      console.log(HELP);
      return 0;
    case "seed": {
      await checkTables();
      const s = await seed(cmd.me);
      if (cmd.counts) {
        console.log(`Walkthrough data is ready: ${SEEDED_LETTERS.length} test accounts, 1 league with 2 players, 1 match today.`);
        return 0;
      }
      console.log(`
Walkthrough data is ready.

Accounts (sign in with Email; the code is always ${TEST_EMAIL_CODE})
  A  ${s.john.name} <${s.john.email}>   You. League admin.
${SEEDED_LETTERS.map((l) => `  ${l}  ${fullName(l).padEnd(13)} ${WALKTHROUGH_ACCOUNTS[l].email}   ${WALKTHROUGH_ACCOUNTS[l].role}`).join("\n")}

League
  ${SEEDED_LEAGUE_NAME} (id ${s.leagueId}): Private, Flex, singles, top 4 playoffs
  Season: starts ${shortDate(s.startDate)}, 8 weeks. It started today, so new joins go to the waitlist.
  Invite code: ${s.inviteCode}
  Players: ${s.john.name} (you, admin) and ${fullName("B")}

Today's match (match id ${s.matchId})
  ${s.john.name} vs ${fullName("B")}, 6:00 PM at Memorial Park. Round 1, play by ${shortDate(s.deadline)}.

Next: pnpm walkthrough help
`);
      return 0;
    }
    case "demo": {
      await checkTables();
      const d = await seedDemo(cmd);
      if (cmd.counts) {
        console.log(demoCounts(d));
        return 0;
      }
      const time = (at: string) => new Date(at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
      const day = (at: string) => new Date(at).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
      const rec = (r: { wins: number; losses: number }) => `${r.wins} and ${r.losses}`;
      console.log(`
Demo data is ready. Pull to refresh in the app.

${d.league.name} (id ${d.league.id}): Private, you run it
  ${d.league.players} players with you. Season moved to start ${shortDate(d.league.startDate)} (${d.league.weeks} weeks): today is the last day of week 4.
  ${d.league.played} matches played, ${d.league.inGrace} entered late in the grace week, ${d.league.notPlayed} never played. Your record: ${rec(d.league.johnRecord)}.
${d.johnsMatchToday ? `  Tonight: you vs ${d.johnsMatchToday.opponent}, ${time(d.johnsMatchToday.at)} at ${d.johnsMatchToday.location}.\n` : ""}${d.draftRound ? `  Round ${d.draftRound} pairings are waiting for your review in Manage (they go out tomorrow).\n` : ""}  ${d.joinRequests} join request waiting in Manage.${d.league.inviteCode ? `  Invite code: ${d.league.inviteCode}` : ""}

${d.second.name} (id ${d.second.id}): Open, you run it, full
  ${d.second.players} players with you, today is week 3. ${d.second.played} played, ${d.second.inGrace} in the grace week, ${d.second.notPlayed} never played. Your record: ${rec(d.second.johnRecord)}.
${d.johnsMatchLater ? `  ${day(d.johnsMatchLater.at)}: you vs ${d.johnsMatchLater.opponent}, ${time(d.johnsMatchLater.at)} at ${d.johnsMatchLater.location}.\n` : ""}  ${d.second.waitlist} players on the waitlist for next season.

${d.past.name} (id ${d.past.id}): ended
  ${d.past.players} players, ${d.past.played} matches, your record ${rec(d.past.johnRecord)}${d.past.johnSeed ? `, playoff seed ${d.past.johnSeed}` : ""}. Champion: ${d.past.champion}.

Not in your leagues
  ${d.nearby} players within about 30 miles of 12590, and ${d.farAway} far away (Brooklyn, Manhattan, Cambridge) that Discover should never show you.
  Open leagues starting soon: ${d.openLeagues.join(", ")}.

Sign in as any demo player with Email: ballboi-demo-first-last+clerk_test@example.com, code ${TEST_EMAIL_CODE}
  (for example ballboi-demo-maya-chen+clerk_test@example.com)

Messages aren't seeded. Run it again any time to reset to this same data.
`);
      return 0;
    }
    case "accounts": {
      const ids = await seededIds();
      for (const l of SEEDED_LETTERS) {
        const a = WALKTHROUGH_ACCOUNTS[l];
        console.log(`${l}  ${fullName(l).padEnd(13)} ${a.email}  ${ids[l] ? "" : "(not created yet)"}`);
      }
      console.log(`\nSign in on a second device with Email, using the address above and code ${TEST_EMAIL_CODE}.`);
      return 0;
    }
    case "message":
      await message(cmd);
      return 0;
    case "join":
      await join(cmd);
      return 0;
    case "report":
      await report(cmd);
      return 0;
    case "score":
      await score(cmd);
      return 0;
    case "leave":
      await leave(cmd);
      return 0;
    case "time": {
      const result = await applyTimeAction(await leagueIdFrom(cmd.league), cmd.action as TimeAction);
      console.log(result.ok ? `${result.message} (moved ${result.days} day${result.days === 1 ? "" : "s"})` : `Not changed: ${result.message}`);
      return result.ok ? 0 : 1;
    }
    case "pair-now": {
      const result = await pairNow(await leagueIdFrom(cmd.league));
      console.log(result.message);
      return result.ok ? 0 : 1;
    }
  }
}

