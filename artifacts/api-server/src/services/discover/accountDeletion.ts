// Account deletion for Discover (App Store 5.1.1(v); Session F acceptance 48).
// Each Discover feature removes its own data here: your Discover settings and
// point, and your "When you can play" hours. Reports you filed stay for
// moderators with your name taken off (lib/accountDeletion.ts), and blocks
// either way go with the account there too.

import {
  directoryCourtsTable,
  discoverProfilesTable,
  matchPlansTable,
  openMatchAlertsTable,
  openMatchPlayersTable,
  openMatchesTable,
  weeklyAvailabilityTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";
import type { Tx } from "../../lib/recordingCleanup";

export async function deleteDiscoverData(tx: Tx, clerkUserId: string): Promise<void> {
  // Match cards you sent or got (the match rows themselves are anonymized with your player rows).
  await tx
    .delete(matchPlansTable)
    .where(or(eq(matchPlansTable.proposerClerkUserId, clerkUserId), eq(matchPlansTable.recipientClerkUserId, clerkUserId)));
  // Open matches: your posts (with their joins and chats), your spots in others', alerts. Group chat lines go with the messaging service.
  await tx.delete(openMatchesTable).where(eq(openMatchesTable.posterClerkUserId, clerkUserId));
  await tx.delete(openMatchPlayersTable).where(eq(openMatchPlayersTable.clerkUserId, clerkUserId));
  await tx.delete(openMatchAlertsTable).where(eq(openMatchAlertsTable.clerkUserId, clerkUserId));
  await tx.delete(weeklyAvailabilityTable).where(eq(weeklyAvailabilityTable.clerkUserId, clerkUserId));
  await tx.delete(discoverProfilesTable).where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
  // Courts you added to the directory. Anyone who picked one as a home court loses it (set null).
  await tx.delete(directoryCourtsTable).where(eq(directoryCourtsTable.addedByClerkUserId, clerkUserId));
}
