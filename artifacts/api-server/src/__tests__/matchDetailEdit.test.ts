import { describe, it, expect } from "vitest";
import { CASUAL_LOCKED_MESSAGE, planCasualEdit, type CasualEditMatch } from "../lib/matchScoreEdit.js";

// Decision 151: the 24-hour edit for Discover and Quick matches, with no
// league standings to move and no admin to correct it afterwards.

const NOW = new Date("2026-11-08T20:00:00Z");
const m = (o: Partial<CasualEditMatch> = {}): CasualEditMatch => ({
  leagueId: null,
  player1Id: 10,
  player2Id: 20,
  player3Id: null,
  player4Id: null,
  status: "completed",
  score: "6-3, 6-4",
  winnerId: 10,
  voidedAt: null,
  playoffBracketId: null,
  recordedAt: "2026-11-08T12:00:00Z",
  recordedByClerkUserId: "a",
  correctedAt: null,
  ...o,
});
const plan = (o: Partial<Parameters<typeof planCasualEdit>[0]> = {}) =>
  planCasualEdit({ match: m(), userId: "a", accounts: ["a", "b"], myPlayerIds: [10], raw: "6-4, 6-4", now: NOW, ...o });

describe("planCasualEdit", () => {
  it("stores the edit from player 1's side, whoever makes it", () => {
    expect(plan()).toEqual({ ok: true, score: "6-4, 6-4", winnerId: 10, yourScore: "6-4, 6-4" });
    expect(plan({ userId: "b", myPlayerIds: [20], raw: "6-4, 6-4" })).toEqual({ ok: true, score: "4-6, 4-6", winnerId: 20, yourScore: "6-4, 6-4" });
  });

  it("allows as many sets as a Quick match does", () => {
    expect(plan({ raw: "6-4, 4-6, 6-3, 3-6, 7-5" })).toMatchObject({ ok: true, winnerId: 10 });
  });

  it("locks after 24 hours with plain words and no admin", () => {
    const out = plan({ now: new Date("2026-11-09T12:00:00Z") });
    expect(out).toEqual({ ok: false, status: 409, error: CASUAL_LOCKED_MESSAGE });
    expect(CASUAL_LOCKED_MESSAGE).toBe("Scores lock 24 hours after they're entered.");
  });

  it("is for Discover and Quick matches only", () => {
    expect(plan({ match: m({ leagueId: 4 }) })).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses someone not in the match, and a match with no score", () => {
    expect(plan({ userId: "c", myPlayerIds: [] })).toMatchObject({ ok: false, status: 403 });
    expect(plan({ match: m({ status: "scheduled", score: null }) })).toMatchObject({ ok: false, status: 409 });
  });

  it("never mentions a league admin", () => {
    const out = plan({ match: m({ recordedByClerkUserId: "gone" }) });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(out.ok ? "" : out.error).not.toMatch(/admin/i);
  });
});
