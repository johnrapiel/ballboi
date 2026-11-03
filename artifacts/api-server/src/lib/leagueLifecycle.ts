// Leaving, ending, and deleting a league (Oct 31 review, C8 to C10;
// decision 31). Pure rules, so they're easy to test.
//
// - The league's only admin can't leave: "Make someone a co-admin first".
//   With two or more admins, leaving works as before.
// - Ending freezes standings, cancels unpublished rounds, and moves the league
//   to Past. All history stays.
// - Deleting needs the league's name typed. It removes the league, its rounds
//   and its matches, and leaves each member a note. Ball Boi recordings belong
//   to the players, so matches with a recording are kept, detached from the
//   league, with their stats.

export const ONLY_ADMIN_MESSAGE = "Make someone a co-admin first";
export const ENDED_MESSAGE = "This league has ended";

export function leaveCheck(input: { isAdmin: boolean; adminCount: number }): { ok: true } | { ok: false; status: number; code: string; error: string } {
  if (input.isAdmin && input.adminCount <= 1) {
    return { ok: false, status: 409, code: "only_admin", error: `${ONLY_ADMIN_MESSAGE}. You're this league's only admin.` };
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
