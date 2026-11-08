import { describe, expect, it } from "vitest";

import { careerCells, careerResultRow, careerSpoken, headToHeadRow, seasonRecord, seasonResults, shareLabel } from "@/lib/career";

// Career (decision 147): labels and VoiceOver text.

const career = {
  wins: 24,
  losses: 9,
  played: 33,
  bestWinStreak: 5,
  sets: { won: 52, lost: 22 },
  games: { won: 380, lost: 301 },
  tiebreaks: { won: 3, lost: 2 },
};

describe("career", () => {
  it("shows shares as whole percents, or a dash before anything was played", () => {
    expect(shareLabel({ won: 52, lost: 22 })).toBe("70%");
    expect(shareLabel({ won: 0, lost: 0 })).toBe("–");
  });

  it("has six cells in order", () => {
    expect(careerCells(career)).toEqual([
      { label: "Record", value: "24–9" },
      { label: "Played", value: "33" },
      { label: "Best streak", value: "W5" },
      { label: "Sets won", value: "70%" },
      { label: "Games won", value: "56%" },
      { label: "Tiebreaks", value: "3–2" },
    ]);
  });

  it("reads the whole group in words", () => {
    expect(careerSpoken(career)).toBe(
      "Career: record 24 and 9, played 33, best win streak 5, 70 percent of sets won, 52 of 74, 56 percent of games won, 380 of 681, tiebreaks 3 won, 2 lost",
    );
    expect(careerSpoken({ ...career, wins: 0, losses: 0, played: 0, bestWinStreak: 0, sets: { won: 0, lost: 0 }, games: { won: 0, lost: 0 }, tiebreaks: { won: 0, lost: 0 } })).toBe(
      "Career: record 0 and 0, played 0, no wins yet, no sets yet, no games yet, no tiebreaks yet",
    );
  });

  it("writes head-to-head rows", () => {
    expect(headToHeadRow({ userId: 2, name: "Sam Patel", wins: 2, losses: 1 })).toEqual({ text: "Sam Patel · 2-1", spoken: "Sam Patel. You won 2, lost 1." });
  });

  it("writes a season's record", () => {
    expect(seasonRecord({ wins: 5, losses: 1 })).toEqual({ text: "5-1", spoken: "5 wins, 1 loss" });
    expect(seasonRecord({ wins: 1, losses: 0 })).toEqual({ text: "1-0", spoken: "1 win, 0 losses" });
  });

  it("picks one season's results and reads them like Profile's Results", () => {
    const r = { matchId: 1, seasonKey: "s:2026-09-01:2026-12-31", opponentName: "Sam Patel", won: true, score: "6-3, 6-4", context: "Discover", playoff: false, league: false, completedAt: null };
    const results = [r, { ...r, matchId: 2, seasonKey: "y:2026" }];
    expect(seasonResults({ results }, "y:2026").map((x) => x.matchId)).toEqual([2]);
    expect(careerResultRow(r)).toEqual({ won: true, score: "6-3, 6-4", opponentName: "Sam Patel", leagueName: "Discover", playoff: false, inGrace: false });
  });
});
