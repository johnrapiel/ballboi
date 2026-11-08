import { describe, expect, it } from "vitest";

import { editedLine } from "@/lib/leagueSchedule";
import {
  durationLabel,
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
