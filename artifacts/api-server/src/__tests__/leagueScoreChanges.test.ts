import { describe, it, expect } from "vitest";
import { checkCorrection, checkEdit, EDIT_WINDOW_MS, editDeadline, recordChanges } from "../lib/leagueScoreChanges.js";

// Finding 7 (John, Nov 6): either player edits the score for 24 hours, then it
// locks. C5: admins correct scores from Manage.

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
const players = ["user_a", "user_b"];
const at = (ms: number) => new Date(Date.parse(enteredAt) + ms);
const HOUR = 60 * 60_000;

describe("editDeadline", () => {
  it("gives both players 24 hours from when the score was entered", () => {
    const until = new Date(Date.parse(enteredAt) + EDIT_WINDOW_MS).toISOString();
    expect(editDeadline(played, "user_a", players, at(HOUR))).toBe(until);
    expect(editDeadline(played, "user_b", players, at(23 * HOUR))).toBe(until);
  });
  it("is null for anyone not in the match", () => {
    expect(editDeadline(played, "user_c", players, at(HOUR))).toBeNull();
    expect(editDeadline(played, null, players, at(HOUR))).toBeNull();
  });
  it("locks after 24 hours", () => {
    expect(editDeadline(played, "user_a", players, at(EDIT_WINDOW_MS))).toBeNull();
  });
  it("is null once an admin corrected it, or when the admin entered the result", () => {
    expect(editDeadline({ ...played, correctedAt: new Date() }, "user_a", players, at(1000))).toBeNull();
    expect(editDeadline({ ...played, recordedByClerkUserId: "admin" }, "user_a", players, at(1000))).toBeNull();
  });
  it("is null with no score", () => {
    expect(editDeadline({ ...played, status: "scheduled", score: null }, "user_a", players, at(1000))).toBeNull();
  });
});

describe("checkEdit", () => {
  it("lets either player edit inside the 24 hours", () => {
    expect(checkEdit(played, "user_a", players, at(HOUR))).toEqual({ ok: true });
    expect(checkEdit(played, "user_b", players, at(23 * HOUR))).toEqual({ ok: true });
  });
  it("refuses anyone not in the match", () => {
    expect(checkEdit(played, "user_c", players, at(1000))).toMatchObject({ ok: false, status: 403 });
  });
  it("locks after 24 hours and points to the league admin", () => {
    const out = checkEdit(played, "user_a", players, at(EDIT_WINDOW_MS + 1));
    expect(out).toMatchObject({ ok: false, status: 409 });
    if (!out.ok) expect(out.error).toMatch(/league admin can correct it/);
  });
  it("refuses a corrected score, an unplayed match and a cancelled one", () => {
    expect(checkEdit({ ...played, correctedAt: new Date() }, "user_a", players, at(1000))).toMatchObject({ ok: false });
    expect(checkEdit({ ...played, status: "scheduled", score: null }, "user_a", players, at(1000))).toMatchObject({ ok: false });
    expect(checkEdit({ ...played, voidedAt: new Date() }, "user_a", players, at(1000))).toMatchObject({ ok: false });
  });
  it("edits a playoff score only until the match it feeds is played", () => {
    const playoff = { ...played, playoffBracketId: 2 };
    expect(checkEdit(playoff, "user_a", players, at(1000), { next: { status: "scheduled" } })).toEqual({ ok: true });
    expect(checkEdit(playoff, "user_a", players, at(1000), { next: { status: "completed" } })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("checkCorrection", () => {
  it("corrects a played weekly match", () => {
    expect(checkCorrection(played)).toEqual({ ok: true });
  });
  it("refuses unplayed and cancelled matches", () => {
    expect(checkCorrection({ ...played, status: "scheduled", score: null })).toMatchObject({ ok: false });
    expect(checkCorrection({ ...played, voidedAt: new Date() })).toMatchObject({ ok: false });
  });
  it("corrects a playoff match until the match it feeds is played", () => {
    expect(checkCorrection({ ...played, playoffBracketId: 2 }, null)).toEqual({ ok: true });
    expect(checkCorrection({ ...played, playoffBracketId: 2 }, { status: "scheduled" })).toEqual({ ok: true });
    const out = checkCorrection({ ...played, playoffBracketId: 2 }, { status: "completed" });
    expect(out).toMatchObject({ ok: false, status: 409 });
    if (!out.ok) expect(out.error).toMatch(/stands/);
  });
});

describe("recordChanges", () => {
  it("takes a win and a loss back when a result is cleared", () => {
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
