// Who's in on the league join screen (Wave 2 findings 34 and 60): the first
// 8 members, then a "Show N more" link that expands the list in place to
// everyone. Pure, so it's tested in Node.

/** Who's in shows this many members until "Show N more" is tapped. */
export const WHOS_IN_LIMIT = 8;

/** The members to show, and how many are hidden behind "Show N more" (0 once expanded or when all fit). */
export function whosInShown<T>(members: readonly T[], expanded: boolean, limit = WHOS_IN_LIMIT): { shown: T[]; more: number } {
  const shown = expanded ? members.slice() : members.slice(0, limit);
  return { shown, more: members.length - shown.length };
}

/** "Show 5 more" on screen, "Show 5 more players" to VoiceOver. */
export function showMoreLabel(more: number): { label: string; spoken: string } {
  return { label: `Show ${more} more`, spoken: `Show ${more} more ${more === 1 ? "player" : "players"}` };
}
