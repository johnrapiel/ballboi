import { describe, expect, it } from "vitest";

import { cardSpoken } from "@/lib/playerCard";
import { earnedLine, knownMilestones, MILESTONE_ICONS, MILESTONE_TITLES, milestoneAnnouncement, milestonesSpoken, scoreEnteredAnnouncement } from "@/lib/milestones";
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
