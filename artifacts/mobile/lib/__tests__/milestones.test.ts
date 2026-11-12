import { describe, expect, it } from "vitest";

import { cardSpoken } from "@/lib/playerCard";
import {
  earnedLine,
  knownMilestones,
  MILESTONE_HOW,
  MILESTONE_ICONS,
  MILESTONE_SHORT,
  MILESTONE_TITLES,
  milestoneAnnouncement,
  milestoneBadgeLabel,
  milestonesSpoken,
  scoreEnteredAnnouncement,
  SHOW_MILESTONES,
  visibleMilestones,
} from "@/lib/milestones";
import { BRUSH_PATHS } from "@/components/icons/brushPaths";

// Milestones (decisions 149 and 150) and the score-entered moment's words.

describe("milestones", () => {
  it("has a title and a drawn brush icon for every launch milestone", () => {
    expect(Object.values(MILESTONE_TITLES)).toEqual(["First win", "First Ball Boi match", "5-match win streak", "10-match win streak"]);
    for (const icon of Object.values(MILESTONE_ICONS)) expect(BRUSH_PATHS[icon]).toBeTruthy();
  });

  it("drops kinds this app doesn't know", () => {
    const list = [{ kind: "first_win" }, { kind: "mystery" }] as { kind: "first_win" }[];
    expect(knownMilestones(list)).toEqual([{ kind: "first_win" }]);
  });

  it("reads milestones as part of the card summary", () => {
    expect(milestonesSpoken([{ kind: "first_win" }, { kind: "win_streak_5" }])).toBe("milestones: first win, 5-match win streak");
    expect(milestonesSpoken([])).toBeNull();
    const card = { name: "John Rapiel", rating: 3.5, plays: "singles" as const, town: "Wappingers Falls", distance: null, homeCourt: "Beacon Courts", you: true };
    expect(cardSpoken({ ...card, milestones: [{ kind: "first_win", earnedAt: "2026-10-03T18:00:00Z" }, { kind: "win_streak_5", earnedAt: "2026-10-20T18:00:00Z" }] })).toBe(
      "Your player card. John Rapiel, level 3.5, singles, Wappingers Falls, milestones: first win, 5-match win streak. Home court Beacon Courts.",
    );
    expect(cardSpoken({ ...card, milestones: [] })).toBe("Your player card. John Rapiel, level 3.5, singles, Wappingers Falls. Home court Beacon Courts.");
  });

  it("writes the earned date and the moment's announcement", () => {
    expect(earnedLine("2026-10-03T18:00:00Z")).toBe("Earned Oct 3, 2026");
    expect(milestoneAnnouncement("first_win")).toBe("Milestone: First win");
    expect(milestoneAnnouncement("win_streak_10")).toBe("Milestone: 10-match win streak");
  });
});

describe("milestone labels", () => {
  it("gives every badge a short label under it", () => {
    expect(MILESTONE_SHORT).toEqual({
      first_win: "First win",
      first_ball_boi: "First Ball Boi",
      win_streak_5: "5 wins in a row",
      win_streak_10: "10 wins in a row",
    });
    // Short labels fit under a small badge: never longer than the full title.
    for (const [kind, short] of Object.entries(MILESTONE_SHORT)) {
      expect(short.length).toBeLessThanOrEqual(MILESTONE_TITLES[kind as keyof typeof MILESTONE_TITLES].length);
      expect(short).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("says how each milestone is earned in one plain line", () => {
    expect(MILESTONE_HOW).toEqual({
      first_win: "Win a league, Discover or confirmed Quick match.",
      first_ball_boi: "Record a match with Ball Boi and save the recording.",
      win_streak_5: "Win 5 league, Discover or confirmed Quick matches in a row.",
      win_streak_10: "Win 10 league, Discover or confirmed Quick matches in a row.",
    });
    for (const line of Object.values(MILESTONE_HOW)) {
      expect(line.split(". ").length).toBe(1);
      expect(line).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("covers the same milestones as the titles", () => {
    const kinds = Object.keys(MILESTONE_TITLES).sort();
    expect(Object.keys(MILESTONE_SHORT).sort()).toEqual(kinds);
    expect(Object.keys(MILESTONE_HOW).sort()).toEqual(kinds);
  });

  it("reads a badge button as the full title and the date", () => {
    expect(milestoneBadgeLabel({ kind: "first_ball_boi", earnedAt: "2026-10-03T18:00:00Z" })).toBe("First Ball Boi match, earned Oct 3, 2026");
    expect(milestoneBadgeLabel({ kind: "win_streak_5", earnedAt: "not a date" })).toBe("5-match win streak, earned");
  });
});

describe("score entered", () => {
  it("announces the new record", () => {
    expect(scoreEnteredAnnouncement(true, { wins: 14, losses: 6 }, { wins: 15, losses: 6 })).toBe("Win recorded. You're now 15 and 6.");
    expect(scoreEnteredAnnouncement(false, { wins: 15, losses: 6 }, { wins: 15, losses: 7 })).toBe("Loss recorded. You're now 15 and 7.");
  });

  it("just says the score was saved when the record didn't change", () => {
    expect(scoreEnteredAnnouncement(true, { wins: 3, losses: 1 }, { wins: 3, losses: 1 })).toBe("Score saved");
    expect(scoreEnteredAnnouncement(true, null, null)).toBe("Score saved");
  });
});

describe("visibleMilestones (decision 179)", () => {
  const at = "2026-10-03T18:00:00Z";
  const list = [{ kind: "first_win" as const, earnedAt: at }, { kind: "made_up" as never, earnedAt: at }, { kind: "win_streak_5" as const, earnedAt: at }];

  it("is hidden in the app until after all waves", () => {
    expect(SHOW_MILESTONES).toBe(false);
    expect(visibleMilestones(list)).toEqual([]);
  });

  it("shows the known ones, as before, when the flag is on", () => {
    expect(visibleMilestones(list, true)).toEqual([{ kind: "first_win", earnedAt: at }, { kind: "win_streak_5", earnedAt: at }]);
    expect(visibleMilestones(null, true)).toEqual([]);
  });

  it("leaves nothing for VoiceOver to read while hidden", () => {
    expect(cardSpoken({ name: "Sam Lee", rating: null, plays: null, town: null, distance: null, homeCourt: null, you: false, milestones: visibleMilestones(list) })).not.toMatch(/milestone/);
  });
});
