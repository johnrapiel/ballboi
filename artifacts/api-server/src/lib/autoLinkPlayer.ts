import { db } from "@workspace/db";
import { usersTable, playersTable, matchInvitesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import pino from "pino";

const logger = pino({ name: "autoLinkPlayer" });

/**
 * Find a unique Clerk user ID that matches the given player name / email.
 *
 * Priority:
 *   1. Exact email match (case-insensitive, trimmed) — preferred
 *   2. Exact display-name match (case-insensitive, trimmed) — only when unique
 *
 * Returns null when:
 *   - No match exists
 *   - A name match is ambiguous (multiple users share that display name)
 */
export async function findMatchingClerkUserId(
  playerName: string,
  playerEmail?: string | null
): Promise<string | null> {
  const allUsers = await db.select().from(usersTable);

  if (playerEmail?.trim()) {
    const emailNorm = playerEmail.trim().toLowerCase();
    const emailMatches = allUsers.filter(
      (u) => u.email?.trim().toLowerCase() === emailNorm
    );
    if (emailMatches.length === 1) return emailMatches[0].clerkUserId;
    if (emailMatches.length > 1) return null;
  }

  const nameTrim = playerName.trim().toLowerCase();
  const nameMatches = allUsers.filter(
    (u) => u.displayName.trim().toLowerCase() === nameTrim
  );
  if (nameMatches.length === 1) return nameMatches[0].clerkUserId;

  return null;
}

/**
 * Quick match placeholders (players someone typed in by name) join only
 * through their invite link, never by a name or email match, so a stranger
 * with the same name never gets someone else's match.
 */
async function placeholderPlayerIds(): Promise<Set<number>> {
  const rows = await db.select({ id: matchInvitesTable.placeholderPlayerId }).from(matchInvitesTable);
  return new Set(rows.map((r) => r.id));
}

/**
 * Attempt to auto-link a single player record that has no clerkUserId.
 * The update predicate includes `clerkUserId IS NULL` so an already-linked
 * player is never overwritten, even under concurrent requests.
 * Returns the clerkUserId that was linked, or null if no confident match.
 */
export async function autoLinkPlayer(player: {
  id: number;
  name: string;
  email?: string | null;
  clerkUserId?: string | null;
}): Promise<string | null> {
  if (player.clerkUserId) return player.clerkUserId;
  if ((await placeholderPlayerIds()).has(player.id)) return null;
  const clerkUserId = await findMatchingClerkUserId(player.name, player.email);
  if (!clerkUserId) return null;
  await db
    .update(playersTable)
    .set({ clerkUserId })
    .where(and(eq(playersTable.id, player.id), isNull(playersTable.clerkUserId)));
  return clerkUserId;
}

/**
 * When a user profile is created or updated, scan all unlinked player records
 * and link any whose canonical best match (per findMatchingClerkUserId) resolves
 * to THIS user's clerkUserId.
 *
 * This delegates all matching + ambiguity logic to findMatchingClerkUserId,
 * so email-over-name precedence and uniqueness checks are identical in both
 * the forward (player→user) and reverse (user→player) directions.
 *
 * The DB update includes `clerkUserId IS NULL` so already-linked rows are
 * never overwritten even under concurrent requests.
 *
 * Returns the count of players that were linked.
 */
export async function autoLinkPlayersForUser(user: {
  clerkUserId: string;
  displayName: string;
  email?: string | null;
}): Promise<number> {
  const unlinked = await db
    .select()
    .from(playersTable)
    .where(isNull(playersTable.clerkUserId));

  if (unlinked.length === 0) return 0;

  const placeholders = await placeholderPlayerIds();
  let linked = 0;

  for (const player of unlinked) {
    if (placeholders.has(player.id)) continue;
    const resolvedId = await findMatchingClerkUserId(player.name, player.email);
    if (resolvedId !== user.clerkUserId) continue;

    await db
      .update(playersTable)
      .set({ clerkUserId: user.clerkUserId })
      .where(and(eq(playersTable.id, player.id), isNull(playersTable.clerkUserId)));
    linked++;
  }

  if (linked > 0) {
    logger.info({ clerkUserId: user.clerkUserId, linked }, "Auto-linked players to user");
  }

  return linked;
}

/**
 * Backfill: iterate all unlinked players and attempt to auto-link each one.
 * Returns counts of matched, skipped (ambiguous / no match), and already-linked.
 */
export async function backfillAutoLink(): Promise<{
  matched: number;
  skipped: number;
  alreadyLinked: number;
}> {
  const players = await db.select().from(playersTable);
  let matched = 0;
  let skipped = 0;
  let alreadyLinked = 0;

  for (const player of players) {
    if (player.clerkUserId) {
      alreadyLinked++;
      continue;
    }
    const linked = await autoLinkPlayer(player);
    if (linked) matched++;
    else skipped++;
  }

  logger.info({ matched, skipped, alreadyLinked }, "Auto-link backfill complete");
  return { matched, skipped, alreadyLinked };
}
