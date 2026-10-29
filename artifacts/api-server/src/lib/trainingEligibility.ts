// Spec (Video and training data): "A match enters the training set only if
// both players left it on." Non-users (placeholder opponents) are never
// trained on until they join and their own toggle applies.
//
// Session E: call matchIsTrainingEligible(matchId) before keeping a match's
// video for training; delete it after analysis otherwise.

import { db, matchesTable, playersTable, recordingConsentTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface Participant {
  /** Null for a placeholder opponent who hasn't joined Ball Boi. */
  clerkUserId: string | null;
}

/**
 * True only when every player has an account and none turned training off.
 * A player with no saved choice has the default: on.
 */
export function isTrainingEligible(participants: Participant[], trainingOff: Set<string>): boolean {
  if (participants.length === 0) return false;
  return participants.every((p) => p.clerkUserId != null && !trainingOff.has(p.clerkUserId));
}

export async function matchIsTrainingEligible(matchId: number): Promise<boolean> {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return false;
  const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const players = await db
    .select({ clerkUserId: playersTable.clerkUserId })
    .from(playersTable)
    .where(inArray(playersTable.id, ids));
  if (players.length !== ids.length) return false;
  const clerkIds = players.map((p) => p.clerkUserId).filter((id): id is string => id != null);
  const prefs = clerkIds.length
    ? await db
        .select({ clerkUserId: recordingConsentTable.clerkUserId, trainingEnabled: recordingConsentTable.trainingEnabled })
        .from(recordingConsentTable)
        .where(inArray(recordingConsentTable.clerkUserId, clerkIds))
    : [];
  const off = new Set(prefs.filter((p) => !p.trainingEnabled).map((p) => p.clerkUserId));
  return isTrainingEligible(players, off);
}
