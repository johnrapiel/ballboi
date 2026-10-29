import { ballBoiDoublesViewsTable, db, recordingConsentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Account deletion (App Store 5.1.1(v)) for the data the Ball Boi recording
// flow stores. Called from deleteAccount() inside its transaction.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deleteRecordingData(tx: Tx, clerkUserId: string): Promise<void> {
  await tx.delete(ballBoiDoublesViewsTable).where(eq(ballBoiDoublesViewsTable.clerkUserId, clerkUserId));
  await tx.delete(recordingConsentTable).where(eq(recordingConsentTable.clerkUserId, clerkUserId));
}
