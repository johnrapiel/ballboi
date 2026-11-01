// Walkthrough test data (development only): the seeded accounts, the seeded
// league, and the reset that makes `pnpm seed:walkthrough` safe to re-run.
// The CLI that prints and acts on it is walkthrough.ts.

import { clerkClient } from "@clerk/express";
import {
  accountSanctionsTable,
  contentReportsTable,
  db,
  leagueAdminsTable,
  leagueInvitesTable,
  leaguesTable,
  matchesTable,
  messagingRestrictionsTable,
  playersTable,
  usersTable,
  type League,
} from "@workspace/db";
import { desc, eq, inArray, or } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { deleteAccount } from "../lib/accountDeletion.js";
import { leagueToday } from "../lib/leagueCalendar.js";
import { seasonDates } from "../lib/leagueSetup.js";
import {
  SEEDED_LEAGUE_MARKER,
  SEEDED_LEAGUE_NAME,
  SEEDED_LETTERS,
  WALKTHROUGH_ACCOUNTS,
  type Letter,
  type SeededLetter,
} from "../lib/walkthrough.js";
import { ensureDraft, publishRound } from "../services/leagueRounds.js";

/** A problem to show as-is, without a stack trace. */
export class Problem extends Error {}

const quiet = { warn: () => {}, info: () => {} };
const newInviteCode = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);

export interface SeedSummary {
  john: { name: string; email: string };
  leagueId: number;
  inviteCode: string;
  startDate: string;
  matchId: number;
  deadline: string;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

async function clerkUserByEmail(email: string) {
  const { data } = await clerkClient.users.getUserList({ emailAddress: [email] });
  return data[0] ?? null;
}

/** John's account: --me, else ADMIN_EMAIL. */
export async function johnsAccount(me: string | null) {
  const email = me ?? process.env.ADMIN_EMAIL;
  if (!email) throw new Problem("Set ADMIN_EMAIL in .env, or pass --me <your sign-in email>.");
  const user = await clerkUserByEmail(email);
  if (!user) throw new Problem(`No Clerk account for ${email}. Sign in to the app once with that email, then run this again.`);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || email.split("@")[0];
  return { id: user.id, name, email };
}

/** The Clerk account for B, C or D, created on first run. Age check marked passed. */
async function seededClerkUser(letter: SeededLetter): Promise<string> {
  const a = WALKTHROUGH_ACCOUNTS[letter];
  const existing = await clerkUserByEmail(a.email);
  if (existing) {
    await clerkClient.users.updateUserMetadata(existing.id, { unsafeMetadata: { ageCheck: "passed" } });
    return existing.id;
  }
  const created = await clerkClient.users.createUser({
    emailAddress: [a.email],
    firstName: a.firstName,
    lastName: a.lastName,
    skipPasswordRequirement: true,
    unsafeMetadata: { ageCheck: "passed" },
  });
  return created.id;
}

/** Clerk ids for B, C and D that already exist, without creating any. */
export async function seededIds(): Promise<Partial<Record<SeededLetter, string>>> {
  const ids: Partial<Record<SeededLetter, string>> = {};
  for (const l of SEEDED_LETTERS) {
    const u = await clerkUserByEmail(WALKTHROUGH_ACCOUNTS[l].email);
    if (u) ids[l] = u.id;
  }
  return ids;
}

export async function idFor(letter: Letter, me: string | null = null): Promise<string> {
  if (letter === "A") return (await johnsAccount(me)).id;
  const ids = await seededIds();
  const id = ids[letter];
  if (!id) throw new Problem(`${letter} doesn't exist yet. Run: pnpm seed:walkthrough`);
  return id;
}

export const fullName = (l: SeededLetter) => `${WALKTHROUGH_ACCOUNTS[l].firstName} ${WALKTHROUGH_ACCOUNTS[l].lastName}`;

// ─── Seed ────────────────────────────────────────────────────────────────────

export async function seededLeague(): Promise<League | null> {
  const [league] = await db
    .select()
    .from(leaguesTable)
    .where(eq(leaguesTable.description, SEEDED_LEAGUE_MARKER))
    .orderBy(desc(leaguesTable.id))
    .limit(1);
  return league ?? null;
}

/** Removes the seeded league and everything B, C and D did, so a run starts fresh. */
export async function reset(ids: string[]) {
  // The seeded league, with its matches and players.
  const leagues = await db.select({ id: leaguesTable.id }).from(leaguesTable).where(eq(leaguesTable.description, SEEDED_LEAGUE_MARKER));
  const leagueIds = leagues.map((l) => l.id);
  if (leagueIds.length) {
    await db.delete(matchesTable).where(inArray(matchesTable.leagueId, leagueIds));
    await db.delete(playersTable).where(inArray(playersTable.leagueId, leagueIds));
    await db.delete(leaguesTable).where(inArray(leaguesTable.id, leagueIds));
  }
  if (!ids.length) return;

  // B, C and D's league places and matches anywhere, including leagues John made during the walkthrough.
  const players = await db.select({ id: playersTable.id }).from(playersTable).where(inArray(playersTable.clerkUserId, ids));
  const playerIds = players.map((p) => p.id);
  if (playerIds.length) {
    await db
      .delete(matchesTable)
      .where(or(
        inArray(matchesTable.player1Id, playerIds),
        inArray(matchesTable.player2Id, playerIds),
        inArray(matchesTable.player3Id, playerIds),
        inArray(matchesTable.player4Id, playerIds),
      ));
    await db.delete(playersTable).where(inArray(playersTable.id, playerIds));
  }

  // Moderation state about or by them, so auto-restrict, bans and reports can be tried again.
  await db
    .delete(contentReportsTable)
    .where(or(inArray(contentReportsTable.reporterClerkUserId, ids), inArray(contentReportsTable.subjectClerkUserId, ids)));
  await db.delete(messagingRestrictionsTable).where(inArray(messagingRestrictionsTable.clerkUserId, ids));
  await db.delete(accountSanctionsTable).where(inArray(accountSanctionsTable.clerkUserId, ids));

  // Everything else each feature cleans up on account deletion (profile, blocks,
  // conversations, recordings, consent...), keeping the Clerk account itself.
  for (const id of ids) {
    await deleteAccount(id, quiet, { deleteClerkUser: async () => undefined });
  }
}

export async function seed(me: string | null): Promise<SeedSummary> {
  const john = await johnsAccount(me);
  const ids: Record<SeededLetter, string> = { B: "", C: "", D: "" };
  for (const l of SEEDED_LETTERS) ids[l] = await seededClerkUser(l);
  await reset(Object.values(ids));

  // Profiles for B, C and D: onboarding done, so they land on the tabs.
  for (const l of SEEDED_LETTERS) {
    const a = WALKTHROUGH_ACCOUNTS[l];
    await db.insert(usersTable).values({
      clerkUserId: ids[l],
      displayName: fullName(l),
      email: a.email,
      rating: a.rating,
      ratingSource: "self",
      homeZip: a.zip,
      intent: "join_league",
      onboardingComplete: true,
    });
  }

  // A Private league run by John that started today, with John and B in it.
  const today = leagueToday();
  const weeks = 8;
  const [mine] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, john.id));
  const [league] = await db
    .insert(leaguesTable)
    .values({
      name: SEEDED_LEAGUE_NAME,
      description: SEEDED_LEAGUE_MARKER,
      format: "flex",
      status: "active",
      leagueType: "singles",
      visibility: "private",
      startDate: today,
      endDate: seasonDates(today, weeks).endDate,
      seasonWeeks: weeks,
      playoffSize: 4,
      location: "Memorial Park, Beacon",
      createdByClerkUserId: john.id,
    })
    .returning();
  await db.insert(leagueAdminsTable).values({ leagueId: league.id, clerkUserId: john.id, role: "owner" });
  const [code] = await db
    .insert(leagueInvitesTable)
    .values({ code: newInviteCode(), leagueId: league.id, createdByClerkUserId: john.id, isActive: true })
    .returning({ code: leagueInvitesTable.code });
  await db.insert(playersTable).values([
    { name: mine?.displayName ?? john.name, clerkUserId: john.id, leagueId: league.id, skillLevel: mine?.rating ? mine.rating.toFixed(1) : "3.5" },
    { name: fullName("B"), clerkUserId: ids.B, leagueId: league.id, skillLevel: WALKTHROUGH_ACCOUNTS.B.rating.toFixed(1) },
  ]);

  // C and D aren't in a league. Each gets a player profile so others can message or report them.
  await db.insert(playersTable).values(
    (["C", "D"] as const).map((l) => ({ name: fullName(l), clerkUserId: ids[l], skillLevel: WALKTHROUGH_ACCOUNTS[l].rating.toFixed(1) })),
  );

  // Round 1 goes out today: John vs B, at 6pm today at Memorial Park.
  const draft = await ensureDraft(league, 1);
  if (!draft) throw new Problem("Couldn't pair round 1.");
  await publishRound(league, draft.round);
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.roundId, draft.round.id));
  await db
    .update(matchesTable)
    .set({ scheduledAt: `${today}T22:00:00.000Z`, location: "Memorial Park, Beacon" })
    .where(eq(matchesTable.id, match.id));

  return {
    john: { name: mine?.displayName ?? john.name, email: john.email },
    leagueId: league.id,
    inviteCode: code.code,
    startDate: today,
    matchId: match.id,
    deadline: draft.round.endDate,
  };
}

