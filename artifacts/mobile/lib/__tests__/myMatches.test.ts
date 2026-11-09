import { describe, expect, it } from "vitest";

import { editedLine } from "@/lib/leagueSchedule";
import {
  CASUAL_LOCKED,
  durationLabel,
  matchSourceLine,
  recordLabel,
  resultSentence,
  scoreFootnote,
  setRows,
} from "@/lib/myMatches";

// Findings 6, 7 and 14 (John, Nov 6): Match detail and the record line.

describe("record line", () => {
  it("reads 4–2 with an en dash", () => {
    expect(recordLabel({ wins: 4, losses: 2 })).toBe("4–2");
  });
});

describe("Match detail helpers", () => {
  it("splits a score into set rows, tiebreaks kept, RET and W/O handled", () => {
    expect(setRows("6-4, 7-6(4)")).toEqual([
      { you: 6, them: 4, tiebreak: null },
      { you: 7, them: 6, tiebreak: 4 },
    ]);
    expect(setRows("6-3, 2-1 RET")).toHaveLength(2);
    expect(setRows("W/O")).toEqual([]);
  });
  it("says who beat whom from the winner's side", () => {
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "6-4, 7-5", youWon: true })).toBe("John Rapiel beat Ray Alvarez 6-4, 7-5");
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "4-6, 5-7", youWon: false })).toBe("Ray Alvarez beat John Rapiel 6-4, 7-5");
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "6-3, 2-1 RET", youWon: true })).toBe("John Rapiel beat Ray Alvarez 6-3, 2-1, Ray retired");
  });
  it("formats the replay length", () => {
    expect(durationLabel(5520)).toBe("1h 32m");
    expect(durationLabel(2880)).toBe("48m");
    expect(durationLabel(null)).toBeNull();
  });
  it("footnote: who entered it, then the 24 hours, then the league admin", () => {
    const base = { played: true, enteredBy: "John Rapiel", enteredAt: "2026-11-06T19:30:00Z", editUntil: null, correctedBy: null, leagueEnded: false };
    expect(scoreFootnote({ ...base, editUntil: "2026-11-07T19:30:00Z" })).toMatch(/^Entered by John Rapiel, .+\. Either player can edit it until .+\.$/);
    expect(scoreFootnote(base)).toMatch(/Your league admin can correct it in Manage\.$/);
    expect(scoreFootnote({ ...base, leagueEnded: true })).toMatch(/scores are final/);
    expect(scoreFootnote({ ...base, played: false })).toBeNull();
    expect(scoreFootnote({ ...base, enteredBy: null })).toMatch(/^Entered by your league admin\./);
  });
  it("says who edited a score, and nothing before an edit", () => {
    expect(editedLine({ editedBy: "Ray Alvarez" })).toBe("Score edited by Ray Alvarez");
    expect(editedLine({ editedBy: null })).toBeNull();
  });
});

describe("Match detail for every match (decision 151)", () => {
  const base = { played: true, enteredBy: "John Rapiel", enteredAt: "2026-11-06T19:30:00Z", editUntil: null, correctedBy: null, leagueEnded: false };

  it("names where the match came from: the league and round, Discover or Quick match", () => {
    expect(matchSourceLine({ source: "league", leagueName: "Men's 3.5", roundNumber: 3, playoffRound: null })).toBe("Men's 3.5 · Round 3");
    expect(matchSourceLine({ source: "league", leagueName: "Men's 3.5", roundNumber: null, playoffRound: "semifinal" }, () => "Semifinal")).toBe(
      "Men's 3.5 · Playoffs · Semifinal",
    );
    expect(matchSourceLine({ source: "discover", leagueName: null, context: "Discover", roundNumber: null, playoffRound: null })).toBe("Discover");
    expect(matchSourceLine({ source: "quick_match", leagueName: null, context: "Quick match", roundNumber: null, playoffRound: null })).toBe("Quick match");
  });

  it("offers the same 24-hour edit for Discover and Quick matches", () => {
    for (const source of ["discover", "quick_match"] as const) {
      expect(scoreFootnote({ ...base, source, editUntil: "2026-11-07T19:30:00Z" })).toMatch(/^Entered by John Rapiel, .+\. Either player can edit it until .+\.$/);
    }
  });

  it("once locked, says so plainly and never points to an admin", () => {
    for (const source of ["discover", "quick_match"] as const) {
      const note = scoreFootnote({ ...base, source });
      expect(note).toMatch(/^Entered by John Rapiel, .+\. Scores lock 24 hours after they're entered\.$/);
      expect(note).not.toMatch(/admin|Manage/);
      expect(scoreFootnote({ ...base, source, enteredBy: null })).toBe(CASUAL_LOCKED);
    }
    expect(CASUAL_LOCKED).toBe("Scores lock 24 hours after they're entered.");
  });

  it("keeps the league footnote as it was", () => {
    expect(scoreFootnote({ ...base, source: "league" })).toMatch(/Your league admin can correct it in Manage\.$/);
  });
});
