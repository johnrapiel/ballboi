import { ballBoiDoublesViewsTable, db, matchInvitesTable, playersTable, recordingConsentTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

// Account deletion (App Store 5.1.1(v)) for the data the Ball Boi recording
// flow stores. Called from deleteAccount() inside its transaction.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deleteRecordingData(tx: Tx, clerkUserId: string): Promise<void> {
  await tx.delete(ballBoiDoublesViewsTable).where(eq(ballBoiDoublesViewsTable.clerkUserId, clerkUserId));
  await tx.delete(recordingConsentTable).where(eq(recordingConsentTable.clerkUserId, clerkUserId));

  // Quick match placeholders this person typed in and nobody claimed: the name
  // is theirs to delete. Removing the placeholder removes those matches too.
  const unclaimed = await tx
    .select({ playerId: matchInvitesTable.placeholderPlayerId })
    .from(matchInvitesTable)
    .where(and(eq(matchInvitesTable.createdByClerkUserId, clerkUserId), isNull(matchInvitesTable.claimedByClerkUserId)));
  if (unclaimed.length) {
    await tx.delete(playersTable).where(
      and(
        inArray(playersTable.id, unclaimed.map((u) => u.playerId)),
        isNull(playersTable.clerkUserId),
      ),
    );
  }
  // Claimed invites stay with the person who joined, without the creator's ID.
  await tx
    .update(matchInvitesTable)
    .set({ createdByClerkUserId: "deleted" })
    .where(eq(matchInvitesTable.createdByClerkUserId, clerkUserId));
}
