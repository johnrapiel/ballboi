import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import type { Point } from "./discoverArea.js";

/**
 * Where a league shows in Discover once it's Open (spec: Discover): its
 * creator's home area point, already approximate. Null when they haven't set one.
 */
export async function leagueAreaFor(creatorClerkUserId: string): Promise<Point | null> {
  const [u] = await db
    .select({ latitude: usersTable.areaLatitude, longitude: usersTable.areaLongitude })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, creatorClerkUserId));
  return u?.latitude != null && u.longitude != null ? { latitude: u.latitude, longitude: u.longitude } : null;
}
