// Account deletion for notifications (App Store 5.1.1(v); Session G
// acceptance 41). Push tokens go in lib/accountDeletion.ts; the rest of what
// notifications store about an account goes here.

import { notificationSettingsTable, opponentNoticesTable, opponentRequestsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import type { Tx } from "../../lib/recordingCleanup";

export async function deleteNotificationData(tx: Tx, clerkUserId: string): Promise<void> {
  // Settings › Notifications switches.
  await tx.delete(notificationSettingsTable).where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
  // Opponent notices they got, and "Was that you?" requests they sent or got.
  // The match itself stays, like any match with a deleted player.
  await tx.delete(opponentNoticesTable).where(eq(opponentNoticesTable.clerkUserId, clerkUserId));
  await tx
    .delete(opponentRequestsTable)
    .where(or(eq(opponentRequestsTable.opponentClerkUserId, clerkUserId), eq(opponentRequestsTable.recorderClerkUserId, clerkUserId)));
}
