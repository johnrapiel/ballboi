import { describe, it, expect } from "vitest";
import { checkScoreEntry, parseMatchScore, scoreFromSide, winnerIdFor } from "../lib/leagueScoring.js";

// Spec: Leagues > Scores and standings. The first score entered stands
// (decision 24); grace-week scores count for ratings and stats only (decision 25).

const match = {
  status: "scheduled",
  voidedAt: null,
  player1Id: 1,
  player2Id: 2,
  player3Id: null,
  player4Id: null,
  playoffBracketId: null,
};
const round = { startDate: "2026-11-05", endDate: "2026-11-11", publishedAt: new Date("2026-11-05T12:00:00Z") };

describe("checkScoreEntry", () => {
  it("lets either player enter a score during the round", () => {
    expect(checkScoreEntry({ match, round, today: "2026-11-08", callerPlayerIds: [2] })).toEqual({ ok: true, inGrace: false });
  });

  it("counts the deadline day itself for standings", () => {
    expect(checkScoreEntry({ match, round, today: "2026-11-11", callerPlayerIds: [1] })).toEqual({ ok: true, inGrace: false });
  });

  it("marks scores in the week after the deadline as grace-week scores", () => {
    expect(checkScoreEntry({ match, round, today: "2026-11-12", callerPlayerIds: [1] })).toEqual({ ok: true, inGrace: true });
    expect(checkScoreEntry({ match, round, today: "2026-11-18", callerPlayerIds: [1] })).toEqual({ ok: true, inGrace: true });
  });

  it("closes the match after the grace week", () => {
    const r = checkScoreEntry({ match, round, today: "2026-11-19", callerPlayerIds: [1] });
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/grace week .* ended/);
  });

  it("keeps the first score: no second entry", () => {
    const r = checkScoreEntry({ match: { ...match, status: "completed" }, round, today: "2026-11-08", callerPlayerIds: [2] });
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/first score entered stands/);
  });

  it("only lets the match's own players enter it", () => {
    expect(checkScoreEntry({ match, round, today: "2026-11-08", callerPlayerIds: [9] })).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses voided matches and rounds that haven't gone out", () => {
    expect(
      checkScoreEntry({ match: { ...match, voidedAt: new Date() }, round, today: "2026-11-08", callerPlayerIds: [1] }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      checkScoreEntry({ match, round: { ...round, publishedAt: null }, today: "2026-11-08", callerPlayerIds: [1] }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses scores before the round starts", () => {
    expect(checkScoreEntry({ match, round, today: "2026-11-04", callerPlayerIds: [1] })).toMatchObject({ ok: false });
  });

  it("lets playoff matches be scored any day, never as grace-week matches", () => {
    expect(
      checkScoreEntry({ match: { ...match, playoffBracketId: 3 }, round: null, today: "2027-02-01", callerPlayerIds: [1] }),
    ).toEqual({ ok: true, inGrace: false });
  });
});

describe("parseMatchScore", () => {
  it("reads a straight-sets win", () => {
    expect(parseMatchScore("6-3,6-4")).toEqual({ ok: true, score: "6-3, 6-4", winnerSide: 1 });
  });

  it("reads a loss with a tiebreak and a match tiebreak", () => {
    expect(parseMatchScore("6-7(4), 6-3, 7-10")).toEqual({ ok: true, score: "6-7(4), 6-3, 7-10", winnerSide: 2 });
  });

  it("refuses tied sets, tied matches, and nonsense", () => {
    expect(parseMatchScore("6-6").ok).toBe(false);
    expect(parseMatchScore("6-3, 3-6").ok).toBe(false);
    expect(parseMatchScore("six-three").ok).toBe(false);
    expect(parseMatchScore("").ok).toBe(false);
  });
});

describe("score sides", () => {
  it("flips a score to the other player's side, tiebreak points included", () => {
    expect(scoreFromSide("6-3, 6-7(4)", 2)).toBe("3-6, 7-6(4)");
    expect(scoreFromSide("6-3", 1)).toBe("6-3");
  });

  it("names the winner by side", () => {
    expect(winnerIdFor(match, 1)).toBe(1);
    expect(winnerIdFor(match, 2)).toBe(2);
  });
});
