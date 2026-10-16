import { clerkClient } from "@clerk/express";
import {
  ballBoiSessionsTable,
  contentReportsTable,
  db,
  expoPushTokensTable,
  playerAvailabilityTable,
  playerLocationsTable,
  playersTable,
  pushSubscriptionsTable,
  userBlocksTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, isNotNull, or, sql, and } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";

/**
 * App Store guideline 5.1.1(v): users must be able to delete their account and
 * its data from inside the app.
 *
 * What happens:
 * - Personal data is deleted: profile, push tokens, availability, locations,
 *   blocks, and every Ball Boi video they recorded (from storage too).
 * - League player records are anonymized, not deleted, so opponents' match
 *   history and standings stay correct. Name becomes "Deleted player"; email,
 *   phone and bio are cleared and the account link is removed.
 * - Reports they filed stay for moderation with the reporter removed.
 * - Finally the Clerk user is deleted, which signs them out everywhere.
 */

export const DELETED_PLAYER_NAME = "Deleted player";

export interface DeletionSummary {
  playersAnonymized: number;
  sessionsDeleted: number;
  videosDeleted: number;
  videoDeleteFailures: number;
}

export async function deleteAccount(
  clerkUserId: string,
  log: { warn: (o: object, m: string) => void; info: (o: object, m: string) => void },
  deps: { storage?: Pick<ObjectStorageService, "deleteObjectEntity">; deleteClerkUser?: (id: string) => Promise<unknown> } = {},
): Promise<DeletionSummary> {
  const storage = deps.storage ?? new ObjectStorageService();
  const deleteClerkUser = deps.deleteClerkUser ?? ((id: string) => clerkClient.users.deleteUser(id));

  const { videoPaths, playersAnonymized, sessionsDeleted } = await db.transaction(async (tx) => {
    const players = await tx
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(eq(playersTable.clerkUserId, clerkUserId));
    const playerIds = players.map((p) => p.id);

    const sessions = await tx
      .select({ id: ballBoiSessionsTable.id, videoObjectPath: ballBoiSessionsTable.videoObjectPath })
      .from(ballBoiSessionsTable)
      .where(eq(ballBoiSessionsTable.recordedByClerkUserId, clerkUserId));
    if (sessions.length) {
      // Cascades to match_shots and match_statistics for these sessions.
      await tx.delete(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.id, sessions.map((s) => s.id)));
    }

    if (playerIds.length) {
      await tx.delete(playerAvailabilityTable).where(inArray(playerAvailabilityTable.playerId, playerIds));
      await tx.delete(playerLocationsTable).where(inArray(playerLocationsTable.playerId, playerIds));
      await tx
        .update(playersTable)
        .set({ name: DELETED_PLAYER_NAME, email: null, phone: null, bio: null, clerkUserId: null })
        .where(inArray(playersTable.id, playerIds));
    }

    await tx.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, clerkUserId));
    await tx.delete(expoPushTokensTable).where(eq(expoPushTokensTable.userId, clerkUserId));
    await tx
      .delete(userBlocksTable)
      .where(or(eq(userBlocksTable.blockerClerkUserId, clerkUserId), eq(userBlocksTable.blockedClerkUserId, clerkUserId)));
    await tx
      .update(contentReportsTable)
      .set({ reporterClerkUserId: null })
      .where(and(isNotNull(contentReportsTable.reporterClerkUserId), eq(contentReportsTable.reporterClerkUserId, clerkUserId)));
    await tx.delete(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));

    // Legacy table created outside migrations; only touch it if it exists.
    const legacy = await tx.execute(sql`SELECT to_regclass('public.shot_recordings') AS t`);
    if ((legacy.rows[0] as { t: string | null } | undefined)?.t) {
      await tx.execute(sql`DELETE FROM shot_recordings WHERE user_id = ${clerkUserId}`);
    }

    return {
      videoPaths: sessions.map((s) => s.videoObjectPath).filter((p): p is string => !!p),
      playersAnonymized: playerIds.length,
      sessionsDeleted: sessions.length,
    };
  });

  // Storage deletes run after the DB commit. A failure here is logged for
  // cleanup rather than leaving the user stuck with a half-deleted account.
  let videoDeleteFailures = 0;
  for (const path of videoPaths) {
    try {
      await storage.deleteObjectEntity(path);
    } catch (err) {
      videoDeleteFailures++;
      log.warn({ err, path }, "Account deletion: failed to delete video object; needs manual cleanup");
    }
  }

  await deleteClerkUser(clerkUserId);

  const summary = {
    playersAnonymized,
    sessionsDeleted,
    videosDeleted: videoPaths.length - videoDeleteFailures,
    videoDeleteFailures,
  };
  log.info({ summary }, "Account deleted");
  return summary;
}
