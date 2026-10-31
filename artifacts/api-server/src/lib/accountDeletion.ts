import { clerkClient } from "@clerk/express";
import {
  ballBoiSessionsTable,
  contentReportsTable,
  db,
  expoPushTokensTable,
  matchesTable,
  playerAvailabilityTable,
  playerLocationsTable,
  playersTable,
  pushSubscriptionsTable,
  userBlocksTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, or, sql } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";
import { deleteRecordingData } from "./recordingCleanup";

/**
 * App Store guideline 5.1.1(v): people must be able to delete their account and
 * its data from inside the app. Spec: "Account deletion" in App Store implications.
 *
 * What happens:
 * - Personal data is deleted: profile, push tokens, availability, locations, and
 *   the video file of every Ball Boi recording they made.
 * - Recordings shared with an opponent who still has an account keep their shot
 *   data and stats, so the opponent keeps their replay (the same rule as scores).
 *   The video, the AI write-up, and the recorder's ID are removed. Recordings
 *   with no remaining opponent are deleted outright.
 * - Blocks they made or received are removed. Reports they filed stay for
 *   moderation with the reporter removed.
 * - League player records are anonymized, not deleted, so opponents' match
 *   history and standings stay correct. The name becomes "Deleted player";
 *   email, phone and bio are cleared and the account link is removed.
 * - Their profile photo file is deleted with the profile.
 * - Last, the Clerk user is deleted. That signs them out everywhere and, for
 *   Sign in with Apple, removes the Apple connection on Clerk's side.
 *
 * Not built yet, so nothing to delete: messages (Stream), training-set
 * membership, UTR links. Each of those features must hook in here when it lands.
 */

export const DELETED_PLAYER_NAME = "Deleted player";
/** Stands in for the recorder's Clerk ID on recordings kept for the opponent. */
export const DELETED_RECORDER_ID = "deleted";

export interface DeletionSummary {
  playersAnonymized: number;
  recordingsDeleted: number;
  recordingsKeptForOpponents: number;
  videosDeleted: number;
  videoDeleteFailures: number;
}

type Log = { warn: (o: object, m: string) => void; info: (o: object, m: string) => void };

export interface DeletionDeps {
  storage?: Pick<ObjectStorageService, "deleteObject">;
  deleteClerkUser?: (id: string) => Promise<unknown>;
}

export async function deleteAccount(clerkUserId: string, log: Log, deps: DeletionDeps = {}): Promise<DeletionSummary> {
  const storage = deps.storage ?? new ObjectStorageService();
  const deleteClerkUser = deps.deleteClerkUser ?? ((id: string) => clerkClient.users.deleteUser(id));

  const { videoPaths, playersAnonymized, recordingsDeleted, recordingsKept, photoPaths } = await db.transaction(async (tx) => {
    const players = await tx
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(eq(playersTable.clerkUserId, clerkUserId));
    const playerIds = players.map((p) => p.id);

    const sessions = await tx
      .select({
        id: ballBoiSessionsTable.id,
        matchId: ballBoiSessionsTable.matchId,
        videoObjectPath: ballBoiSessionsTable.videoObjectPath,
      })
      .from(ballBoiSessionsTable)
      .where(eq(ballBoiSessionsTable.recordedByClerkUserId, clerkUserId));

    // Which recordings have an opponent who still has an account?
    const keepIds = new Set<number>();
    if (sessions.length) {
      const matchIds = [...new Set(sessions.map((s) => s.matchId))];
      const matches = await tx
        .select({ id: matchesTable.id, player1Id: matchesTable.player1Id, player2Id: matchesTable.player2Id })
        .from(matchesTable)
        .where(inArray(matchesTable.id, matchIds));
      const mine = new Set(playerIds);
      const opponentByMatch = new Map<number, number>();
      for (const m of matches) {
        const opponent = mine.has(m.player1Id) ? m.player2Id : m.player1Id;
        if (!mine.has(opponent)) opponentByMatch.set(m.id, opponent);
      }
      const opponentIds = [...new Set(opponentByMatch.values())];
      const opponents = opponentIds.length
        ? await tx
            .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
            .from(playersTable)
            .where(inArray(playersTable.id, opponentIds))
        : [];
      const opponentsWithAccounts = new Set(opponents.filter((o) => o.clerkUserId).map((o) => o.id));
      for (const s of sessions) {
        const opponent = opponentByMatch.get(s.matchId);
        if (opponent !== undefined && opponentsWithAccounts.has(opponent)) keepIds.add(s.id);
      }
    }

    const keep = sessions.filter((s) => keepIds.has(s.id));
    const drop = sessions.filter((s) => !keepIds.has(s.id));
    if (keep.length) {
      // The opponent keeps the replay and stats; the video and the recorder's details go.
      await tx
        .update(ballBoiSessionsTable)
        .set({
          recordedByClerkUserId: DELETED_RECORDER_ID,
          videoObjectPath: null,
          videoContentType: null,
          videoSizeBytes: null,
          aiNarrative: null,
        })
        .where(inArray(ballBoiSessionsTable.id, keep.map((s) => s.id)));
    }
    if (drop.length) {
      // Cascades to match_shots and match_statistics for these sessions.
      await tx.delete(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.id, drop.map((s) => s.id)));
    }

    // Legacy uploads table, created outside the Drizzle schema. Only touch it if it exists.
    let legacyPaths: string[] = [];
    const legacy = await tx.execute(sql`SELECT to_regclass('public.shot_recordings') AS t`);
    if ((legacy.rows[0] as { t: string | null } | undefined)?.t) {
      const deleted = await tx.execute(
        sql`DELETE FROM shot_recordings WHERE user_id = ${clerkUserId} RETURNING video_object_path`,
      );
      legacyPaths = (deleted.rows as { video_object_path: string | null }[])
        .map((r) => r.video_object_path)
        .filter((p): p is string => !!p);
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
      .where(eq(contentReportsTable.reporterClerkUserId, clerkUserId));
    const profiles = await tx
      .select({ avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId));
    const photoPaths = profiles.map((u) => u.avatarUrl).filter((p): p is string => !!p && p.startsWith("/objects/"));
    await deleteRecordingData(tx, clerkUserId);
    await tx.delete(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));

    const sessionPaths = sessions.map((s) => s.videoObjectPath).filter((p): p is string => !!p);
    return {
      videoPaths: [...new Set([...sessionPaths, ...legacyPaths])],
      playersAnonymized: playerIds.length,
      recordingsDeleted: drop.length,
      recordingsKept: keep.length,
      photoPaths,
    };
  });

  // Video files are deleted after the database commits. A failure is logged for
  // manual cleanup rather than leaving the person with a half-deleted account.
  let videoDeleteFailures = 0;
  for (const path of videoPaths) {
    try {
      await storage.deleteObject(path);
    } catch (err) {
      videoDeleteFailures++;
      log.warn({ err, path }, "Account deletion: video file not deleted; needs manual cleanup");
    }
  }

  // Profile photo, uploaded during onboarding.
  for (const path of photoPaths) {
    try {
      await storage.deleteObject(path);
    } catch (err) {
      log.warn({ err, path }, "Account deletion: profile photo not deleted; needs manual cleanup");
    }
  }

  await deleteClerkUser(clerkUserId);

  const summary: DeletionSummary = {
    playersAnonymized,
    recordingsDeleted,
    recordingsKeptForOpponents: recordingsKept,
    videosDeleted: videoPaths.length - videoDeleteFailures,
    videoDeleteFailures,
  };
  log.info({ summary }, "Account deleted");
  return summary;
}
