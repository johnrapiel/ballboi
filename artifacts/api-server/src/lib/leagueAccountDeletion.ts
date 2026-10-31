// Account deletion for league data this feature creates (App Store 5.1.1(v)).
// Called from deleteAccount() in accountDeletion.ts, inside its transaction.
//
// - Admin roles go: the person no longer runs any league. A league they
//   created loses its creator link too, so nothing falls back to their ID.
// - Requests to join and waitlist spots go: they hold the person's name.
// Their league player rows are anonymized by deleteAccount() itself, so
// opponents' results and standings stay correct.

import { leagueAdminsTable, leagueJoinRequestsTable, leaguesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type Tx = {
  delete: (table: typeof leagueAdminsTable | typeof leagueJoinRequestsTable) => { where: (cond: unknown) => Promise<unknown> };
  update: (table: typeof leaguesTable) => {
    set: (values: { createdByClerkUserId: null }) => { where: (cond: unknown) => Promise<unknown> };
  };
};

export async function deleteLeagueDataFor(tx: Tx, clerkUserId: string): Promise<void> {
  await tx.delete(leagueAdminsTable).where(eq(leagueAdminsTable.clerkUserId, clerkUserId));
  await tx.delete(leagueJoinRequestsTable).where(eq(leagueJoinRequestsTable.clerkUserId, clerkUserId));
  await tx.update(leaguesTable).set({ createdByClerkUserId: null }).where(eq(leaguesTable.createdByClerkUserId, clerkUserId));
}
