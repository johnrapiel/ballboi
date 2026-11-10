// One Live Activity per match per phone (John, Nov 9). Pure, so it's tested
// without a phone: lib/__tests__/liveActivity.test.ts.
//
// A phone is only ever in one Ball Boi match at a time, so a second Ball Boi
// Live Activity on it is always a leftover. Which one stays doesn't matter
// much: the one kept sends its update token, and Ball Boi's server then
// updates it in place.

/**
 * The Live Activities to end: all but one. The mounted phone keeps the one
 * it's updating; any other phone keeps the last one iOS lists.
 */
export function extraActivities(ids: string[], keep: string | null): string[] {
  if (ids.length <= 1) return [];
  const kept = keep && ids.includes(keep) ? keep : ids[ids.length - 1];
  return ids.filter((id) => id !== kept);
}
