import { clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, playersTable, matchInvitesTable } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import pino from "pino";
import { DELETED_PLAYER_NAME } from "./accountDeletion.js";

const logger = pino({ name: "autoLinkPlayer" });

// A2: a league player record an admin added (name plus email) links to a Ball
// Boi account only by that account's verified primary email, read from Clerk
// on the server. Never by display name, never by an email someone typed into
// their profile, never onto a record already linked to another account, and
// never onto a "Deleted player" record left by account deletion.

function normalize(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

type ClerkEmail = { id: string; emailAddress: string; verification?: { status?: string | null } | null };
type ClerkUser = { id: string; primaryEmailAddressId: string | null; emailAddresses: ClerkEmail[] };

function verifiedPrimary(user: ClerkUser): string | null {
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") return null;
  return normalize(primary.emailAddress);
}

/** The user's verified primary email from Clerk, lowercased, or null. */
export async function verifiedPrimaryEmail(clerkUserId: string): Promise<string | null> {
  const user = (await clerkClient.users.getUser(clerkUserId)) as unknown as ClerkUser;
  return verifiedPrimary(user);
}

/**
 * Quick match placeholders (players someone typed in by name) join only
 * through their invite link, never by an email match.
 */
async function placeholderIdsAmong(playerIds: number[]): Promise<Set<number>> {
  if (!playerIds.length) return new Set();
  const rows = await db
    .select({ id: matchInvitesTable.placeholderPlayerId })
    .from(matchInvitesTable)
    .where(inArray(matchInvitesTable.placeholderPlayerId, playerIds));
  return new Set(rows.map((r) => r.id));
}

/** Unlinked league records carrying this email, minus deleted-account and placeholder rows. */
async function linkablePlayers(email: string): Promise<{ id: number }[]> {
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      and(
        isNull(playersTable.clerkUserId),
        ne(playersTable.name, DELETED_PLAYER_NAME),
        sql`lower(trim(${playersTable.email})) = ${email}`,
      ),
    );
  const placeholders = await placeholderIdsAmong(rows.map((r) => r.id));
  return rows.filter((r) => !placeholders.has(r.id));
}

/** Links one record. The `clerkUserId IS NULL` predicate means a linked record is never taken over. */
async function link(playerId: number, clerkUserId: string): Promise<boolean> {
  const updated = await db
    .update(playersTable)
    .set({ clerkUserId })
    .where(and(eq(playersTable.id, playerId), isNull(playersTable.clerkUserId)))
    .returning({ id: playersTable.id });
  return updated.length > 0;
}

/**
 * An admin just added a player with an email. If a Ball Boi account already
 * has that address as its verified primary email, link the record to it.
 * Returns the linked clerkUserId, or null.
 */
export async function autoLinkPlayer(player: {
  id: number;
  name: string;
  email?: string | null;
  clerkUserId?: string | null;
}): Promise<string | null> {
  if (player.clerkUserId) return player.clerkUserId;
  if (player.name === DELETED_PLAYER_NAME) return null;
  const email = normalize(player.email);
  if (!email) return null;
  if ((await placeholderIdsAmong([player.id])).has(player.id)) return null;

  const { data } = (await clerkClient.users.getUserList({ emailAddress: [email] })) as unknown as { data: ClerkUser[] };
  const owners = data.filter((u) => verifiedPrimary(u) === email);
  if (owners.length !== 1) return null;
  const clerkUserId = owners[0].id;

  // Only accounts that have made a Ball Boi profile.
  const [profile] = await db
    .select({ clerkUserId: usersTable.clerkUserId })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  if (!profile) return null;

  return (await link(player.id, clerkUserId)) ? clerkUserId : null;
}

/**
 * Runs once, when a person creates their Ball Boi profile: links the unlinked
 * league records an admin added with their verified primary email. Returns
 * how many were linked.
 */
export async function autoLinkPlayersForUser(clerkUserId: string): Promise<number> {
  const email = await verifiedPrimaryEmail(clerkUserId);
  if (!email) return 0;

  let linked = 0;
  for (const player of await linkablePlayers(email)) {
    if (await link(player.id, clerkUserId)) linked++;
  }
  if (linked > 0) logger.info({ clerkUserId, linked }, "Auto-linked players to user");
  return linked;
}

/**
 * Backfill: try to link every unlinked player record by email. Returns counts
 * of matched, skipped (no verified match), and already-linked.
 */
export async function backfillAutoLink(): Promise<{ matched: number; skipped: number; alreadyLinked: number }> {
  const players = await db.select().from(playersTable);
  let matched = 0;
  let skipped = 0;
  let alreadyLinked = 0;
  for (const player of players) {
    if (player.clerkUserId) { alreadyLinked++; continue; }
    if (await autoLinkPlayer(player)) matched++;
    else skipped++;
  }
  logger.info({ matched, skipped, alreadyLinked }, "Auto-link backfill complete");
  return { matched, skipped, alreadyLinked };
}
