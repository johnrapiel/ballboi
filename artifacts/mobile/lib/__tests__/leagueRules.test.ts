import { describe, expect, it } from "vitest";

import type { BracketSlot, ScheduleMatch } from "@workspace/api-client-react";

import { isPastLeague, pastLabel } from "@/lib/leagues";
import { canEnterScore, pickableDays, recordAction, playoffLine, resultLine, scoreForPlayer } from "@/lib/leagueSchedule";
import { scoreNote, slotActions, slotResult, slotWinningScore } from "@/lib/playoffView";
import { emptySet, readScore, readWeeks, setRowsToShow, setsFromScore, showsTiebreak, sixAllPrompt, type SetEntry } from "@/lib/scoreEntry";

// PR 5 (Wave 1 review): the score sheet's rules (C10, Q6), season weeks (C8),
// playoff copy (C9, C15, C18, C24, Q5b), and where a left league shows (C5).

const set = (me: string, them: string, tbMe = "", tbThem = ""): SetEntry => ({ me, them, tbMe, tbThem });

describe("readScore (C10)", () => {
  it("reads a real score from my side", () => {
    expect(readScore([set("6", "3"), set("6", "4"), emptySet()])).toEqual({ ok: true, score: "6-3, 6-4", iWon: true, setsWon: 2, setsLost: 0 });
    expect(readScore([set("6", "3"), set("3", "6"), set("7", "10")])).toMatchObject({ ok: true, score: "6-3, 3-6, 7-10", iWon: false });
    expect(readScore([set("7", "6", "7", "4"), set("6", "2"), emptySet()])).toMatchObject({ ok: true, score: "7-6(4), 6-2" });
  });

  it("refuses 9-2 and 6-5 with a reason", () => {
    expect(readScore([set("9", "2"), set("6", "3"), emptySet()])).toEqual({ ok: false, message: "9-2 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
    expect(readScore([set("6", "5"), set("6", "3"), emptySet()])).toEqual({ ok: false, message: "6-5 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
  });

  it("waits quietly while the sheet is still being filled in", () => {
    expect(readScore([emptySet(), emptySet(), emptySet()])).toEqual({ ok: false, message: null });
    expect(readScore([set("6", ""), emptySet(), emptySet()])).toEqual({ ok: false, message: null });
    expect(readScore([set("6", "3"), emptySet(), emptySet()])).toEqual({ ok: false, message: null });
  });

  it("asks for the third set at one set all", () => {
    expect(readScore([set("6", "3"), set("3", "6"), emptySet()])).toMatchObject({ ok: false, message: expect.stringMatching(/^The sets are tied/) });
  });

  it("ignores a third set once someone has won two", () => {
    expect(readScore([set("6", "3"), set("6", "4"), set("6", "1")])).toMatchObject({ ok: true, score: "6-3, 6-4" });
  });
});

describe("setRowsToShow", () => {
  it("shows the third set only when the first two are split", () => {
    expect(setRowsToShow([emptySet(), emptySet(), emptySet()])).toBe(2);
    expect(setRowsToShow([set("6", "3"), set("6", "4")])).toBe(2);
    expect(setRowsToShow([set("6", "3"), set("4", "6")])).toBe(3);
    expect(setRowsToShow([set("6", "3"), set("4", "5")])).toBe(2);
  });
});

describe("Opponent retired (Q6)", () => {
  it("saves the sets so far as my win, with RET", () => {
    expect(readScore([set("3", "6"), set("2", "1"), emptySet()], { retired: true })).toEqual({
      ok: true,
      score: "3-6, 2-1 RET",
      iWon: true,
      setsWon: 0,
      setsLost: 1,
    });
  });

  it("says when the match was already over", () => {
    expect(readScore([set("6", "3"), set("6", "4"), emptySet()], { retired: true })).toEqual({
      ok: false,
      message: "That match was finished. Turn off Opponent retired to save it.",
    });
  });

  it("shows RET from either side, and reads W/O as no sets", () => {
    expect(scoreForPlayer("6-3, 2-1 RET", { player1Id: 1 }, 2)).toBe("3-6, 1-2 RET");
    expect(setsFromScore("6-3, 2-1 RET", 3).slice(0, 2)).toEqual([set("6", "3"), set("2", "1")]);
    expect(setsFromScore("W/O", 2)).toEqual([emptySet(), emptySet()]);
  });
});

describe("readWeeks (C8)", () => {
  it("takes what's typed", () => {
    expect(readWeeks("12")).toEqual({ weeks: 12, note: null });
    expect(readWeeks("")).toEqual({ weeks: null, note: null });
  });
  it("snaps 30 and 0 with a note", () => {
    expect(readWeeks("30")).toEqual({ weeks: 24, note: "A season is 24 weeks at most, so this one is 24 weeks." });
    expect(readWeeks("0")).toEqual({ weeks: 1, note: "A season is at least 1 week, so this one is 1 week." });
  });
});

const slot = (over: Partial<BracketSlot> = {}): BracketSlot => ({
  round: "semifinal",
  slot: 1,
  matchId: 9,
  player1: { seed: 1, playerId: 1, playerName: "Alex" },
  player2: { seed: 4, playerId: 2, playerName: "Sam" },
  status: "scheduled",
  score: null,
  winnerId: null,
  ...over,
});

describe("playoff results and actions", () => {
  it("reads a win by player 2 from the winner's side (C18)", () => {
    const s = slot({ status: "completed", score: "3-6, 4-6", winnerId: 2 });
    expect(slotWinningScore(s)).toBe("6-3, 6-4");
    expect(slotResult(s, { pastPlayBy: false }, false)).toBe("Sam won 6-3, 6-4");
  });

  it("shows a walkover as W/O (Q5)", () => {
    expect(slotResult(slot({ status: "completed", score: "W/O", winnerId: 1 }), { pastPlayBy: false }, false)).toBe("Alex won by W/O");
  });

  it("never says Not played yet once the league has ended (C24)", () => {
    expect(slotResult(slot(), { pastPlayBy: false }, true)).toBe("Not played");
    expect(slotResult(slot(), { pastPlayBy: false }, false)).toBe("Not played yet");
  });

  it("offers no Enter score in an ended league (C15) or after the play-by date (Q5b)", () => {
    const me = { myPlayerId: 1, isAdmin: false, ended: false };
    expect(slotActions(slot(), { pastPlayBy: false }, me)).toEqual({ enterScore: true, settle: false });
    expect(slotActions(slot(), { pastPlayBy: false }, { ...me, ended: true })).toEqual({ enterScore: false, settle: false });
    expect(slotActions(slot(), { pastPlayBy: true }, me)).toEqual({ enterScore: false, settle: false });
    expect(slotActions(slot(), { pastPlayBy: true }, { ...me, myPlayerId: 7, isAdmin: true })).toEqual({ enterScore: false, settle: true });
    expect(slotActions(slot({ player2: null }), { pastPlayBy: true }, { ...me, isAdmin: true })).toEqual({ enterScore: false, settle: false });
  });

  it("says a playoff score moves the winner on, and that either player can edit for 24 hours (C9, finding 7)", () => {
    expect(scoreNote({ correcting: false, settling: false, playoffRound: "semifinal" }).text).toBe(
      "This sends the winner to the next round. Either player can edit it for 24 hours, until that round is played.",
    );
    expect(scoreNote({ correcting: false, settling: false, playoffRound: null }).text).toMatch(/edit it for 24 hours/);
    expect(scoreNote({ correcting: false, settling: false, playoffRound: null }).text).not.toMatch(/undo/i);
    expect(scoreNote({ correcting: false, settling: false, editing: true, playoffRound: null }).text).toMatch(/sees that you edited it/);
  });
});

describe("weekly matches in an ended league (C24)", () => {
  const m = {
    matchId: 1,
    player1Id: 1,
    player2Id: 2,
    player1Name: "Alex",
    player2Name: "Sam",
    status: "scheduled",
    score: null,
    winnerId: null,
    voided: false,
  } as unknown as ScheduleMatch;
  const round = { phase: "open" } as const;

  it("reads Not played and can't be scored", () => {
    expect(resultLine(m, round, true)).toBe("Not played");
    expect(resultLine(m, round, false)).toBe("Not played yet");
    expect(canEnterScore(round as never, m, true)).toBe(false);
    expect(canEnterScore(round as never, m, false)).toBe(true);
  });
});

describe("playoffLine (C21)", () => {
  it("says when there aren't enough players", () => {
    expect(playoffLine(4, 3)).toBe("Not enough players for playoffs this season.");
    expect(playoffLine(4, 6)).toBe("Top 4 make the playoffs.");
    expect(playoffLine(8, 6)).toBe("Top 4 make the playoffs.");
    expect(playoffLine(8, 9)).toBe("Top 8 make the playoffs.");
    expect(playoffLine(0, 9)).toBeNull();
  });
});

describe("Leagues tab (C5)", () => {
  it("puts a league I left under Past, marked Left", () => {
    expect(isPastLeague({ status: "active", endedAt: null, youLeft: true })).toBe(true);
    expect(pastLabel({ endedAt: null, youLeft: true })).toBe("Left");
    expect(isPastLeague({ status: "active", endedAt: null, youLeft: false })).toBe(false);
    expect(pastLabel({ endedAt: "2026-11-01T00:00:00Z", youLeft: false })).toBe("Ended");
  });
});

describe("readScore for a Quick match (Nov 4, John)", () => {
  const quick = { quick: true };

  it("saves one set, and skips empty rows", () => {
    expect(readScore([set("6", "4"), emptySet()], quick)).toEqual({ ok: true, score: "6-4", iWon: true, setsWon: 1, setsLost: 0 });
    expect(readScore([emptySet(), set("3", "6")], quick)).toMatchObject({ ok: true, score: "3-6", iWon: false });
  });

  it("saves two sets, with one set all decided on games", () => {
    expect(readScore([set("6", "2"), set("4", "6")], quick)).toMatchObject({ ok: true, score: "6-2, 4-6", iWon: true, setsWon: 1, setsLost: 1 });
  });

  it("saves four sets, past two sets won", () => {
    expect(readScore([set("6", "3"), set("6", "4"), set("3", "6"), set("6", "1")], quick)).toMatchObject({
      ok: true,
      score: "6-3, 6-4, 3-6, 6-1",
      setsWon: 3,
      setsLost: 1,
    });
  });

  it("refuses level sets and games, and sets that aren't real", () => {
    expect(readScore([set("6", "4"), set("4", "6")], quick)).toEqual({
      ok: false,
      message: "The sets and games are level, so there's no winner. Add the set or tiebreak that decided it.",
    });
    expect(readScore([set("9", "2"), emptySet()], quick)).toEqual({ ok: false, message: "9-2 isn't a valid set. A set ends 6-0 to 6-4, 7-5 or 7-6." });
  });

  it("waits quietly while a row is half filled", () => {
    expect(readScore([set("6", ""), emptySet()], quick)).toEqual({ ok: false, message: null });
    expect(readScore([emptySet(), emptySet()], quick)).toEqual({ ok: false, message: null });
  });

  it("leaves league matches best of three", () => {
    expect(readScore([set("6", "4"), emptySet(), emptySet()])).toEqual({ ok: false, message: null });
  });
});

describe("a set typed as 6-6 (finding 5, John, Nov 6)", () => {
  it("shows the tiebreak boxes, for 6-6 as well as 7-6", () => {
    expect(showsTiebreak(set("6", "6"))).toBe(true);
    expect(showsTiebreak(set("7", "6"))).toBe(true);
    expect(showsTiebreak(set("6", "4"))).toBe(false);
    expect(sixAllPrompt(2)).toBe("Set 2 went to a tiebreak. Enter the tiebreak score.");
  });

  it("waits for both tiebreak boxes before it can save", () => {
    expect(readScore([set("6", "6"), set("6", "3"), emptySet()])).toEqual({ ok: false, message: null });
    expect(readScore([set("6", "6", "7"), set("6", "3"), emptySet()])).toEqual({ ok: false, message: null });
  });

  it("gives the set to the tiebreak's winner and saves it as 7-6(x)", () => {
    expect(readScore([set("6", "4"), set("6", "6", "7", "5"), emptySet()])).toEqual({
      ok: true,
      score: "6-4, 7-6(5)",
      iWon: true,
      setsWon: 2,
      setsLost: 0,
    });
    expect(readScore([set("6", "6", "4", "7"), set("3", "6"), emptySet()])).toMatchObject({ ok: true, score: "6-7(4), 3-6", iWon: false });
    expect(readScore([set("6", "6", "12", "10"), set("6", "2"), emptySet()])).toMatchObject({ ok: true, score: "7-6(10), 6-2" });
  });

  it("counts a 6-6 tiebreak toward one set all, so the third set opens", () => {
    expect(setRowsToShow([set("6", "6", "7", "3"), set("2", "6"), emptySet()])).toBe(3);
    expect(setRowsToShow([set("6", "6"), set("2", "6"), emptySet()])).toBe(2);
  });

  it("says why an unfinished tiebreak can't save", () => {
    expect(readScore([set("6", "6", "6", "5"), set("6", "3"), emptySet()])).toEqual({
      ok: false,
      message: "Set 1 tiebreak: 6-5 isn't a finished tiebreak. A tiebreak goes to 7, won by 2, like 7-5 or 10-8.",
    });
  });

  it("still saves 7-6 typed directly, with or without the tiebreak", () => {
    expect(readScore([set("7", "6"), set("6", "2"), emptySet()])).toMatchObject({ ok: true, score: "7-6, 6-2" });
    expect(readScore([set("7", "6", "7", "4"), set("6", "2"), emptySet()])).toMatchObject({ ok: true, score: "7-6(4), 6-2" });
    expect(readScore([set("7", "6", "4", "7"), set("6", "2"), emptySet()])).toEqual({
      ok: false,
      message: "Set 1 tiebreak: whoever wins the tiebreak wins the set 7-6.",
    });
  });

  it("works the same on a Quick match", () => {
    expect(readScore([set("6", "6", "7", "2"), emptySet()], { quick: true })).toMatchObject({ ok: true, score: "7-6(2)", iWon: true });
  });

  it("lets a retired match stop at 6-6", () => {
    expect(readScore([set("6", "3"), set("6", "6"), emptySet()], { retired: true })).toMatchObject({ ok: true, score: "6-3, 6-6 RET" });
  });
});

describe("pickableDays (finding 10)", () => {
  it("starts at today once the round has begun, so past days can't be picked", () => {
    expect(pickableDays("2026-11-02", "2026-11-08", "2026-11-06")).toEqual({ first: "2026-11-06", last: "2026-11-08" });
  });
  it("starts at the round's first day before it begins", () => {
    expect(pickableDays("2026-11-09", "2026-11-15", "2026-11-06")).toEqual({ first: "2026-11-09", last: "2026-11-15" });
  });
  it("is null once the round's last day has passed", () => {
    expect(pickableDays("2026-11-02", "2026-11-08", "2026-11-09")).toBeNull();
  });
});

describe("Record with Ball Boi on League detail (John, Nov 8, option A)", () => {
  const m = {
    matchId: 1,
    player1Id: 1,
    player2Id: 2,
    player1Name: "Alex",
    player2Name: "Sam",
    status: "scheduled",
    score: null,
    winnerId: null,
    voided: false,
  } as unknown as ScheduleMatch;
  const r = (phase: string) => ({ phase }) as never;

  it("shows Record any day of an open or grace week on an unplayed singles match", () => {
    expect(recordAction(r("open"), m, false, false)).toBe("record");
    expect(recordAction(r("grace"), m, false, false)).toBe("record");
  });

  it("shows the dimmed doubles state on a doubles match", () => {
    expect(recordAction(r("open"), m, false, true)).toBe("doubles");
    expect(recordAction(r("grace"), m, false, true)).toBe("doubles");
  });

  it("hides Record once the score is in", () => {
    const scored = { ...m, status: "completed", score: "6-3, 6-4", winnerId: 1 } as ScheduleMatch;
    expect(recordAction(r("open"), scored, false, false)).toBeNull();
    expect(recordAction(r("open"), { ...m, score: "6-3, 6-4" } as ScheduleMatch, false, false)).toBeNull();
    expect(recordAction(r("open"), scored, false, true)).toBeNull();
  });

  it("hides Record when the round is upcoming, closed or voided, or the league has ended", () => {
    expect(recordAction(r("upcoming"), m, false, false)).toBeNull();
    expect(recordAction(r("closed"), m, false, false)).toBeNull();
    expect(recordAction(r("open"), { ...m, voided: true } as ScheduleMatch, false, false)).toBeNull();
    expect(recordAction(r("open"), m, true, false)).toBeNull();
    expect(recordAction(r("open"), m, true, true)).toBeNull();
  });
});
