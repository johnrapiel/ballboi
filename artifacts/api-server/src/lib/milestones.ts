// Career milestones (spec decisions 149 and 150, John, Nov 8). Pure, so the
// rules are tested in __tests__/milestones.test.ts.
//
// Launch set:
// - first_win:      your first win
// - first_ball_boi: your first match recorded with Ball Boi
// - win_streak_5:   5 wins in a row
// - win_streak_10:  10 wins in a row
//
// Earned on the server when the result or recording that earns it is saved,
// once per player, stored with the date of that match. Wins and streaks use
// Career's rules (career.ts): league, Discover and confirmed Quick matches,
// never an unconfirmed Quick match, a placeholder or a cancelled match. A
// match with no winner breaks a streak. A score edited later never takes a
// milestone away.
//
// A Ball Boi match counts once its recording is saved (uploaded), for every
// Ball Boi player in that match: the recorder, and their opponent once
// they're linked to it (a league mate, or a Quick match stranger after Yes).

import { countedMatches, type CareerInput } from "./career.js";

export const MILESTONE_KINDS = ["first_win", "first_ball_boi", "win_streak_5", "win_streak_10"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export interface EarnedMilestone {
  kind: MilestoneKind;
  /** ISO time of the match or recording that earned it. */
  earnedAt: string;
  matchId: number | null;
}

/** A saved Ball Boi recording of a match the account is linked to. */
export interface MilestoneRecording {
  matchId: number;
  /** ISO time the recording stopped (or started, if that's all there is). */
  at: string;
}

/** Every milestone the account has earned, by the date of the match that earned it. */
export function earnedMilestones(input: Pick<CareerInput, "account" | "matches" | "players">, recordings: MilestoneRecording[]): EarnedMilestone[] {
  const out: EarnedMilestone[] = [];
  let run = 0;
  const streaks: [number, MilestoneKind][] = [
    [5, "win_streak_5"],
    [10, "win_streak_10"],
  ];
  for (const c of countedMatches(input)) {
    if (c.won !== true) {
      run = 0;
      continue;
    }
    run++;
    const at = c.at || new Date(0).toISOString();
    if (!out.some((e) => e.kind === "first_win")) out.push({ kind: "first_win", earnedAt: at, matchId: c.m.id });
    for (const [n, kind] of streaks) {
      if (run === n && !out.some((e) => e.kind === kind)) out.push({ kind, earnedAt: at, matchId: c.m.id });
    }
  }
  const first = [...recordings].sort((a, b) => a.at.localeCompare(b.at) || a.matchId - b.matchId)[0];
  if (first) out.push({ kind: "first_ball_boi", earnedAt: first.at, matchId: first.matchId });
  return out.sort((a, b) => a.earnedAt.localeCompare(b.earnedAt) || MILESTONE_KINDS.indexOf(a.kind) - MILESTONE_KINDS.indexOf(b.kind));
}

/** Only the kinds the app knows, in launch-set order. */
export function isMilestoneKind(kind: string): kind is MilestoneKind {
  return (MILESTONE_KINDS as readonly string[]).includes(kind);
}
