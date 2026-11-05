import { db, playersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// The player row a match outside any league uses: Quick matches and accepted
// match requests. A row without a league if the account has one, otherwise
// any of theirs, otherwise a new one.

/** The caller's player row for a Quick match: an existing one, or a new one. */
export async function myPlayerId(userId: string): Promise<{ id: number; name: string }> {
  const rows = await db
    .select({ id: playersTable.id, name: playersTable.name, leagueId: playersTable.leagueId })
    .from(playersTable)
    .where(eq(playersTable.clerkUserId, userId));
  const best = rows.find((r) => r.leagueId == null) ?? rows[0];
  if (best) return { id: best.id, name: best.name };
  const [user] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, userId));
  const [created] = await db
    .insert(playersTable)
    .values({ name: user?.displayName ?? "Player", clerkUserId: userId })
    .returning({ id: playersTable.id, name: playersTable.name });
  return created;
}
