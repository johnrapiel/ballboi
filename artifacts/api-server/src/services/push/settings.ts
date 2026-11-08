import { db, notificationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Settings › Notifications, saved to the account so every phone matches.

export interface NotificationSettings {
  messagePreviews: boolean;
  matchReminders: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { messagePreviews: true, matchReminders: true };

export async function notificationSettingsFor(clerkUserId: string): Promise<NotificationSettings> {
  const [row] = await db
    .select({ messagePreviews: notificationSettingsTable.messagePreviews, matchReminders: notificationSettingsTable.matchReminders })
    .from(notificationSettingsTable)
    .where(eq(notificationSettingsTable.clerkUserId, clerkUserId));
  return row ? { messagePreviews: row.messagePreviews, matchReminders: row.matchReminders } : { ...DEFAULT_NOTIFICATION_SETTINGS };
}

export async function saveNotificationSettings(clerkUserId: string, next: Partial<NotificationSettings>): Promise<NotificationSettings> {
  const merged = { ...(await notificationSettingsFor(clerkUserId)), ...next };
  await db
    .insert(notificationSettingsTable)
    .values({ clerkUserId, ...merged, updatedAt: new Date() })
    .onConflictDoUpdate({ target: notificationSettingsTable.clerkUserId, set: { ...merged, updatedAt: new Date() } });
  return merged;
}

/** Reads a PUT body: either switch, each true or false, at least one. */
export function parseSettingsUpdate(body: unknown): Partial<NotificationSettings> | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<NotificationSettings> = {};
  for (const key of ["messagePreviews", "matchReminders"] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "boolean") return { error: `${key} must be true or false.` };
    out[key] = b[key] as boolean;
  }
  if (Object.keys(out).length === 0) return { error: "Nothing to change." };
  return out;
}
