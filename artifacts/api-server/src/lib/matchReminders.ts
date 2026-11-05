// Match day reminders (Wave 2, spec decision 73): on by default. A player gets
// the day-before reminder unless they turned the Profile switch off (the
// account setting) or the older per-league switch is off on that league row.
// iOS still decides whether it shows: no push token, no reminder.

export interface ReminderPlayer {
  clerkUserId: string | null;
  dayBeforeMatchReminderEnabled: boolean;
}

/** Accounts to remind, from a match's players, leaving out anyone who turned reminders off. */
export function remindedUserIds(
  players: (ReminderPlayer | null | undefined)[],
  turnedOff: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const p of players) {
    if (!p?.clerkUserId || !p.dayBeforeMatchReminderEnabled) continue;
    if (turnedOff.has(p.clerkUserId) || ids.includes(p.clerkUserId)) continue;
    ids.push(p.clerkUserId);
  }
  return ids;
}
