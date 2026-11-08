import type { Milestone, MilestoneKind } from "@workspace/api-client-react";

import type { IconName } from "@/components/icons/brushPaths";

// Career milestones (spec decisions 149 and 150, John, Nov 8): first win,
// first Ball Boi match, 5- and 10-match win streaks. Earned on the server,
// shown as brush-ring badges on the player card and Career, and played once
// as a moment the next time you open the app. Pure, so the words are tested
// in lib/__tests__/milestones.test.ts.

export const MILESTONE_TITLES: Record<MilestoneKind, string> = {
  first_win: "First win",
  first_ball_boi: "First Ball Boi match",
  win_streak_5: "5-match win streak",
  win_streak_10: "10-match win streak",
};

/** The brush icon inside each badge's ring (scripts/design/brush-icons.py). */
export const MILESTONE_ICONS: Record<MilestoneKind, IconName> = {
  first_win: "milestone.firstwin",
  first_ball_boi: "milestone.ballboi",
  win_streak_5: "milestone.streak5",
  win_streak_10: "milestone.streak10",
};

/** Kinds this version of the app knows, so a newer server's milestone never breaks the card. */
export function knownMilestones<T extends Pick<Milestone, "kind">>(list: readonly T[] | null | undefined): T[] {
  return (list ?? []).filter((m) => m.kind in MILESTONE_TITLES);
}

/** On the card's VoiceOver summary: "milestones: first win, 5-match win streak", or null with none. */
export function milestonesSpoken(list: readonly Pick<Milestone, "kind">[] | null | undefined): string | null {
  const known = knownMilestones(list);
  if (!known.length) return null;
  return `milestones: ${known.map((m) => MILESTONE_TITLES[m.kind].replace(/^./, (ch) => ch.toLowerCase())).join(", ")}`;
}

/** "Earned Oct 3, 2026", in the phone's time zone. */
export function earnedLine(earnedAt: string): string {
  const d = new Date(earnedAt);
  if (Number.isNaN(d.getTime())) return "Earned";
  return `Earned ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/** What VoiceOver says when the moment plays: "Milestone: First win". */
export function milestoneAnnouncement(kind: MilestoneKind): string {
  return `Milestone: ${MILESTONE_TITLES[kind]}`;
}

/**
 * The score-entered moment's announcement: "Win recorded. You're now 15 and 6."
 * The record is This season's, after this match. With no record change (a
 * match that doesn't count, like one against a placeholder), just "Score saved".
 */
export function scoreEnteredAnnouncement(won: boolean, before: { wins: number; losses: number } | null, after: { wins: number; losses: number } | null): string {
  if (!before || !after || (before.wins === after.wins && before.losses === after.losses)) return "Score saved";
  return `${won ? "Win" : "Loss"} recorded. You're now ${after.wins} and ${after.losses}.`;
}
