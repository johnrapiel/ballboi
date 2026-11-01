// The walkthrough commands (development only). Entry point: walkthrough.ts.

import { clerkClient } from "@clerk/express";
import { db, leaguesTable, matchesTable, playersTable } from "@workspace/db";
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
      const s = await seed(cmd.me);
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

