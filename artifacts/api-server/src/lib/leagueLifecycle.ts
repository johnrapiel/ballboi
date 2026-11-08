// Leaving, ending, and deleting a league (Oct 31 review, C8 to C10;
// decision 31). Pure rules, so they're easy to test.
//
// - Leaving stops your play. An admin who leaves stays an admin and keeps
//   managing the league, so even the only admin can leave (Q4, Nov 4).
// - An admin can't remove themselves from Manage; they use Leave (C26).
// - Ending freezes standings, cancels unpublished rounds, and moves the league
//   to Past. All history stays.
// - Deleting needs the league's name typed. It removes the league, its rounds
//   and its matches, and leaves each member a note. Ball Boi recordings belong
//   to the players, so matches with a recording are kept, detached from the
//   league, with their stats.

export const ENDED_MESSAGE = "This league has ended";

/**
 * A league has ended when an admin tapped End, or on its own once the season
 * and any playoffs are done. Its scores are final (Q9) and its invite codes
 * stop working (Q8).
 */
export function leagueHasEnded(league: { endedAt?: Date | null; status?: string | null } | null | undefined): boolean {
  return !!league && (!!league.endedAt || league.status === "completed");
}

export const REMOVE_SELF_MESSAGE = "To stop playing, use Leave league on the league's page.";

/** C26: removing a player from Manage can't be used on yourself. */
export function removeCheck(input: { playerClerkUserId: string | null; callerClerkUserId: string | null }): { ok: true } | { ok: false; status: number; error: string } {
  if (input.playerClerkUserId && input.playerClerkUserId === input.callerClerkUserId) {
    return { ok: false, status: 409, error: REMOVE_SELF_MESSAGE };
  }
  return { ok: true };
}

/** The typed name must match the league's, ignoring case and extra spaces. */
export function deleteNameMatches(typed: unknown, leagueName: string): boolean {
  if (typeof typed !== "string") return false;
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return tidy(typed) !== "" && tidy(typed) === tidy(leagueName);
}

export function deletedNotice(leagueName: string): string {
  return `${leagueName} was deleted by its organizer`;
}

/** Which of a league's matches are deleted, and which stay because they hold a Ball Boi recording. */
export function splitMatchesForDelete(matchIds: number[], recordedMatchIds: Set<number>): { remove: number[]; keep: number[] } {
  return {
    remove: matchIds.filter((id) => !recordedMatchIds.has(id)),
    keep: matchIds.filter((id) => recordedMatchIds.has(id)),
  };
}
