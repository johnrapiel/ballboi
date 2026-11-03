import { describe, it, expect } from "vitest";
import { checkCorrection, checkUndo, recordChanges, undoDeadline, UNDO_WINDOW_MS } from "../lib/leagueScoreChanges.js";

// Oct 31 review: C4 (undo for 10 minutes) and C5 (admins correct scores).

const enteredAt = "2026-11-06T18:00:00.000Z";
const played = {
  status: "completed",
  score: "6-3, 6-4",
  winnerId: 1,
  voidedAt: null,
  playoffBracketId: null,
  recordedAt: enteredAt,
  recordedByClerkUserId: "user_a",
  correctedAt: null,
};
const at = (ms: number) => new Date(Date.parse(enteredAt) + ms);

describe("undoDeadline", () => {
  it("gives the player who entered the score 10 minutes", () => {
    expect(undoDeadline(played, "user_a", at(60_000))).toBe(new Date(Date.parse(enteredAt) + UNDO_WINDOW_MS).toISOString());
  });
  it("is null for the opponent", () => {
    expect(undoDeadline(played, "user_b", at(60_000))).toBeNull();
  });
  it("is null after 10 minutes", () => {
    expect(undoDeadline(played, "user_a", at(UNDO_WINDOW_MS))).toBeNull();
  });
  it("is null once an admin corrected the score, and for playoffs", () => {
    expect(undoDeadline({ ...played, correctedAt: new Date() }, "user_a", at(1000))).toBeNull();
    expect(undoDeadline({ ...played, playoffBracketId: 3 }, "user_a", at(1000))).toBeNull();
  });
});

describe("checkUndo", () => {
  it("lets the entering player undo inside the window", () => {
    expect(checkUndo(played, "user_a", at(9 * 60_000))).toEqual({ ok: true });
  });
  it("refuses everyone else", () => {
    expect(checkUndo(played, "user_b", at(1000))).toMatchObject({ ok: false, status: 403 });
  });
  it("lets the first score stand after 10 minutes", () => {
    const out = checkUndo(played, "user_a", at(UNDO_WINDOW_MS + 1));
    expect(out).toMatchObject({ ok: false, status: 409 });
    if (!out.ok) expect(out.error).toMatch(/stands/);
  });
  it("has nothing to undo on an unplayed match", () => {
    expect(checkUndo({ ...played, status: "scheduled", score: null }, "user_a", at(1000))).toMatchObject({ ok: false });
  });
});

describe("checkCorrection", () => {
  it("corrects a played weekly match", () => {
    expect(checkCorrection(played)).toEqual({ ok: true });
  });
  it("refuses unplayed, cancelled, and playoff matches", () => {
    expect(checkCorrection({ ...played, status: "scheduled", score: null })).toMatchObject({ ok: false });
    expect(checkCorrection({ ...played, voidedAt: new Date() })).toMatchObject({ ok: false });
    expect(checkCorrection({ ...played, playoffBracketId: 2 })).toMatchObject({ ok: false });
  });
});

describe("recordChanges", () => {
  it("takes a win and a loss back on undo", () => {
    expect(recordChanges([1], [2], 1, null)).toEqual([
      { playerId: 1, wins: -1, losses: 0 },
      { playerId: 2, wins: 0, losses: -1 },
    ]);
  });
  it("swaps the result when a correction flips the winner", () => {
    expect(recordChanges([1], [2], 1, 2)).toEqual([
      { playerId: 1, wins: -1, losses: 1 },
      { playerId: 2, wins: 1, losses: -1 },
    ]);
  });
  it("changes nothing when the winner stays the same", () => {
    expect(recordChanges([1, 3], [2, 4], 2, 2)).toEqual([]);
  });
});
