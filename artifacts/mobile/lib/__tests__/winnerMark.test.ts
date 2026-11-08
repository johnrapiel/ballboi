import { describe, expect, it } from "vitest";

import { sideOf, winnerMark, winnerScoreLine } from "@/lib/winnerMark";

// The winner mark (John, Nov 8): the score line from the winner's side with
// RET or W/O tags, no "X won" on screen, and "[Winner] won [score]" for VoiceOver.

const names = { player1Name: "Elena Ortiz", player2Name: "Andre Thomas" };

describe("winnerScoreLine", () => {
  it("shows the score from the winner's side", () => {
    expect(winnerScoreLine("6-3, 6-4", true)).toBe("6-3, 6-4");
    expect(winnerScoreLine("6-7(8), 6-7(6)", false)).toBe("7-6(8), 7-6(6)");
    expect(winnerScoreLine("6-3, 4-6, 4-10", false)).toBe("3-6, 6-4, 10-4");
  });

  it("tags a retirement and a walkover", () => {
    expect(winnerScoreLine("6-3, 2-1 RET", true)).toBe("6-3, 2-1 · RET");
    expect(winnerScoreLine("3-6, 1-2 RET", false)).toBe("6-3, 2-1 · RET");
    expect(winnerScoreLine("W/O", false)).toBe("W/O");
  });
});

describe("winnerMark", () => {
  it("marks the winner and mutes the loser", () => {
    const m = winnerMark({ ...names, score: "6-7(8), 6-7(6)", winner: 2 });
    expect(m.player1).toBe("loser");
    expect(m.player2).toBe("winner");
    expect(m.line).toBe("7-6(8), 7-6(6)");
    expect(m.line).not.toMatch(/won/);
    expect(m.spoken).toBe("Andre Thomas won 7-6(8), 7-6(6)");
  });

  it("reads a retirement and a walkover in words", () => {
    expect(winnerMark({ ...names, score: "6-3, 2-1 RET", winner: 1 }).spoken).toBe("Elena Ortiz won 6-3, 2-1, Andre Thomas retired");
    const wo = winnerMark({ ...names, score: "W/O", winner: 2 });
    expect(wo.line).toBe("W/O");
    expect(wo.spoken).toBe("Andre Thomas won by walkover");
  });

  it("mutes both names on a match that wasn't played or was cancelled", () => {
    for (const status of ["Not played", "Cancelled"]) {
      const m = winnerMark({ ...names, score: null, winner: null, status });
      expect([m.player1, m.player2, m.line, m.spoken]).toEqual(["muted", "muted", status, status]);
    }
  });

  it("leaves both names plain on a match still to play", () => {
    const m = winnerMark({ ...names, score: null, winner: null, status: "Not played yet" });
    expect([m.player1, m.player2, m.line]).toEqual(["plain", "plain", "Not played yet"]);
    expect(winnerMark({ ...names, score: null, winner: null }).line).toBe("Not played yet");
  });

  it("needs both a winner and a score to mark anyone", () => {
    expect(winnerMark({ ...names, score: "6-3, 6-4", winner: null, status: "Not played" }).winner).toBeNull();
    expect(winnerMark({ ...names, score: "", winner: 1, status: "Not played" }).player1).toBe("muted");
  });
});

describe("sideOf", () => {
  it("finds the winner's side", () => {
    expect(sideOf(7, 7, 9)).toBe(1);
    expect(sideOf(9, 7, 9)).toBe(2);
    expect(sideOf(null, 7, 9)).toBeNull();
    expect(sideOf(3, 7, 9)).toBeNull();
  });
});
