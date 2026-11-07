// Account deletion for Discover (App Store 5.1.1(v); Session F acceptance 48).
// Each Discover feature removes its own data here: your Discover settings and
// point, and your "When you can play" hours. Reports you filed stay for
// moderators with your name taken off (lib/accountDeletion.ts), and blocks
// either way go with the account there too.

import { discoverProfilesTable, weeklyAvailabilityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Tx } from "../../lib/recordingCleanup";

export async function deleteDiscoverData(tx: Tx, clerkUserId: string): Promise<void> {
  await tx.delete(weeklyAvailabilityTable).where(eq(weeklyAvailabilityTable.clerkUserId, clerkUserId));
  await tx.delete(discoverProfilesTable).where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
}
