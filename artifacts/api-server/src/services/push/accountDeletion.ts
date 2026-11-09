// Account deletion for notifications (App Store 5.1.1(v); Session G
// acceptance 41). Push tokens go in lib/accountDeletion.ts; the rest of what
// notifications store about an account goes here.

import { liveActivityTokensTable, liveSessionsTable, matchRemindersLogTable, matchesTable, notificationSettingsTable, opponentNoticesTable, opponentRequestsTable } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import type { Tx } from "../../lib/recordingCleanup";

/**
 * Live Activity tokens (acceptance 41), and the live sessions they recorded.
 * A session is only the state of a match being recorded right now.
 */
export async function deleteLiveActivityData(tx: Tx, clerkUserId: string): Promise<void> {
  await tx.delete(liveActivityTokensTable).where(eq(liveActivityTokensTable.clerkUserId, clerkUserId));
  await tx.delete(liveSessionsTable).where(eq(liveSessionsTable.recorderClerkUserId, clerkUserId));
}

export async function deleteNotificationData(tx: Tx, clerkUserId: string, playerIds: number[] = []): Promise<void> {
  // Settings › Notifications switches.
  await tx.delete(notificationSettingsTable).where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
  // Opponent notices they got, and "Was that you?" requests they sent or got.
  // The match itself stays, like any match with a deleted player.
  await tx.delete(opponentNoticesTable).where(eq(opponentNoticesTable.clerkUserId, clerkUserId));
  await tx
    .delete(opponentRequestsTable)
    .where(or(eq(opponentRequestsTable.opponentClerkUserId, clerkUserId), eq(opponentRequestsTable.recorderClerkUserId, clerkUserId)));
  // Match day reminder logs for their matches. Only past matches keep a log
  // worth anything, and leaving a league cancels its future matches.
  if (playerIds.length) {
    const theirs = tx
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(
        or(
          inArray(matchesTable.player1Id, playerIds),
          inArray(matchesTable.player2Id, playerIds),
          inArray(matchesTable.player3Id, playerIds),
          inArray(matchesTable.player4Id, playerIds),
        ),
      );
    await tx.delete(matchRemindersLogTable).where(inArray(matchRemindersLogTable.matchId, theirs));
  }
}
