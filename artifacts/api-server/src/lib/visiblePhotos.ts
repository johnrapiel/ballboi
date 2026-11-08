import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";

// Profile photos show everywhere a player does (John, Nov 8; spec: "name and
// photo (initials fallback)", photos are public in the privacy table). The
// one exception: nobody gets the photo of someone they blocked or who blocked
// them. Placeholder players (not on Ball Boi) have no account, so no photo.

/**
 * The stored photo path ("/objects/...") for each of these accounts that the
 * viewer may see, keyed by clerkUserId. Accounts with no photo, and accounts
 * with a block either way, are left out.
 */
export async function visiblePhotos(viewer: string, clerkUserIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(clerkUserIds.filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const [rows, hidden] = await Promise.all([
    db.select({ clerkUserId: usersTable.clerkUserId, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(inArray(usersTable.clerkUserId, ids)),
    blockedAccountsFor(viewer),
  ]);
  for (const r of rows) {
    if (r.avatarUrl && !hidden.has(r.clerkUserId)) out.set(r.clerkUserId, r.avatarUrl);
  }
  return out;
}
