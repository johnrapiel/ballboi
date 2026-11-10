// Account deletion for doubles partner data (App Store 5.1.1(v); waves.md:
// each feature cleans up its own data in its own helper). Called from
// deleteAccount() in accountDeletion.ts, inside its transaction.
//
// - Team-up requests to or from the person go: they name them.
// - Their active fixed-partner teams break up as if they'd left (D4): the
//   other player shows "Needs a partner" in Manage. The team rows stay, so
//   played results still name the team, now with "Deleted player".
// - The Find me a partner flag goes with the rest of their player row.

import { db, leaguePartnerRequestsTable, leagueTeamsTable, playersTable } from "@workspace/db";
import { and, inArray, isNull, or } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deleteDoublesDataFor(tx: Tx, playerIds: number[], at: Date = new Date()): Promise<void> {
  if (!playerIds.length) return;
  await tx
    .delete(leaguePartnerRequestsTable)
    .where(or(inArray(leaguePartnerRequestsTable.fromPlayerId, playerIds), inArray(leaguePartnerRequestsTable.toPlayerId, playerIds)));
  await tx
    .update(leagueTeamsTable)
    .set({ dissolvedAt: at, dissolvedReason: "partner_left" })
    .where(and(
      isNull(leagueTeamsTable.dissolvedAt),
      or(inArray(leagueTeamsTable.player1Id, playerIds), inArray(leagueTeamsTable.player2Id, playerIds)),
    ));
  await tx.update(playersTable).set({ lookingForPartnerAt: null }).where(inArray(playersTable.id, playerIds));
}
