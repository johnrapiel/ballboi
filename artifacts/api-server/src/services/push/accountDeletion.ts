// Account deletion for notifications (App Store 5.1.1(v); Session G
// acceptance 41). Push tokens go in lib/accountDeletion.ts; the rest of what
// notifications store about an account goes here.

import { notificationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Tx } from "../../lib/recordingCleanup";

export async function deleteNotificationData(tx: Tx, clerkUserId: string): Promise<void> {
  // Settings › Notifications switches.
  await tx.delete(notificationSettingsTable).where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
}
