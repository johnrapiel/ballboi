import { db, notificationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Settings › Notifications, saved to the account so every phone matches.

export interface NotificationSettings {
  messagePreviews: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { messagePreviews: true };

export async function notificationSettingsFor(clerkUserId: string): Promise<NotificationSettings> {
  const [row] = await db
    .select({ messagePreviews: notificationSettingsTable.messagePreviews })
    .from(notificationSettingsTable)
    .where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
  return row ? { messagePreviews: row.messagePreviews } : { ...DEFAULT_NOTIFICATION_SETTINGS };
}

export async function saveNotificationSettings(clerkUserId: string, next: Partial<NotificationSettings>): Promise<NotificationSettings> {
  const merged = { ...(await notificationSettingsFor(clerkUserId)), ...next };
  await db
    .insert(notificationSettingsTable)
    .values({ clerkUserId, messagePreviews: merged.messagePreviews, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: notificationSettingsTable.clerkUserId,
      set: { messagePreviews: merged.messagePreviews, updatedAt: new Date() },
    });
  return merged;
}

/** Account deletion: the settings row goes with the account. */
export async function deleteNotificationSettings(clerkUserId: string): Promise<void> {
  await db.delete(notificationSettingsTable).where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
}
