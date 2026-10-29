import { db, playersTable, userBlocksTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

/** Every account hidden from this person, whichever side created the block. */
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

/** Pair keys ("<lowId>-<highId>") for player pairs where either account blocked the other. */
export async function blockedPlayerPairs(playerIds: number[]): Promise<Set<string>> {
  const pairs = new Set<string>();
  if (playerIds.length < 2) return pairs;

  const linked = await db
    .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
    .from(playersTable)
    .where(inArray(playersTable.id, playerIds));
  const playerIdsByAccount = new Map<string, number[]>();
  for (const p of linked) {
    if (!p.clerkUserId) continue;
    playerIdsByAccount.set(p.clerkUserId, [...(playerIdsByAccount.get(p.clerkUserId) ?? []), p.id]);
  }
  const accounts = [...playerIdsByAccount.keys()];
  if (accounts.length < 2) return pairs;

  // Rows where the blocker is in this group cover both directions once paired below.
  const blocks = await db
    .select({ a: userBlocksTable.blockerClerkUserId, b: userBlocksTable.blockedClerkUserId })
    .from(userBlocksTable)
    .where(inArray(userBlocksTable.blockerClerkUserId, accounts));
  for (const { a, b } of blocks) {
    for (const x of playerIdsByAccount.get(a) ?? []) {
      for (const y of playerIdsByAccount.get(b) ?? []) pairs.add(pairKey(x, y));
    }
  }
  return pairs;
}

export function pairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}
