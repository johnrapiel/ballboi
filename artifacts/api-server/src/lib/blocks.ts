import { db, userBlocksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Every account hidden from this user, whichever side created the block. */
export async function blockedAccountsFor(clerkUserId: string): Promise<Set<string>> {
  const [mine, theirs] = await Promise.all([
    db
      .select({ id: userBlocksTable.blockedClerkUserId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockerClerkUserId, clerkUserId)),
    db
      .select({ id: userBlocksTable.blockerClerkUserId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockedClerkUserId, clerkUserId)),
  ]);
  return new Set([...mine, ...theirs].map((r) => r.id));
}
