import { describe, it, expect } from "vitest";
import { approveOutcome, joinOutcome, matchesToVoid, ratingRangeLabel } from "../lib/leagueJoining.js";

// Spec: Leagues > Joining and leaving (decisions 26, 27); Discover > Joining an Open league.

const open = { startDate: "2026-11-05", visibility: "open", rosterCap: 8, minRating: "3.0", maxRating: "4.0" };
const priv = { ...open, visibility: "private", minRating: null, maxRating: null, rosterCap: null };

describe("joinOutcome", () => {
  it("joins straight away with an invite before the season starts", () => {
    expect(joinOutcome({ league: priv, activePlayerCount: 3, today: "2026-11-01", via: "invite" })).toEqual({ kind: "join" });
  });

  it("sends an Open-league request to the admin before the season starts", () => {
    expect(
      joinOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", via: "request", skillLevel: "3.5" }),
    ).toEqual({ kind: "request" });
  });

  it("waitlists every league once the season starts, invite or not", () => {
    for (const league of [open, priv]) {
      const out = joinOutcome({ league, activePlayerCount: 3, today: "2026-11-05", via: "invite" });
      expect(out.kind).toBe("waitlist");
      if (out.kind === "waitlist") expect(out.reason).toMatch(/waitlist for next season/);
    }
  });

  it("waitlists a full league", () => {
    const out = joinOutcome({ league: open, activePlayerCount: 8, today: "2026-11-01", via: "invite" });
    expect(out.kind).toBe("waitlist");
  });

  it("keeps Private leagues invite-only", () => {
    expect(joinOutcome({ league: priv, activePlayerCount: 3, today: "2026-11-01", via: "request" })).toMatchObject({
      kind: "refuse",
      status: 403,
    });
  });

  it("checks an Open league's rating range on requests", () => {
    const out = joinOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", via: "request", skillLevel: "4.5" });
    expect(out).toMatchObject({ kind: "refuse", status: 400 });
    if (out.kind === "refuse") expect(out.error).toMatch(/3.0 to 4.0/);
  });
});

describe("approveOutcome", () => {
  const request = { kind: "request", status: "pending" };

  it("approves before the season starts", () => {
    expect(approveOutcome({ league: open, activePlayerCount: 3, today: "2026-11-04", request })).toEqual({ ok: true });
  });

  it("moves a request to the waitlist once the season has started", () => {
    expect(approveOutcome({ league: open, activePlayerCount: 3, today: "2026-11-05", request })).toMatchObject({
      ok: false,
      moveToWaitlist: true,
    });
  });

  it("never approves a waitlist spot into the current season", () => {
    expect(
      approveOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", request: { kind: "waitlist", status: "pending" } }),
    ).toMatchObject({ ok: false, moveToWaitlist: false });
  });

  it("refuses a request that was already handled", () => {
    expect(
      approveOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", request: { ...request, status: "declined" } }),
    ).toMatchObject({ ok: false });
  });
});

describe("matchesToVoid", () => {
  it("voids only the matches that haven't been played", () => {
    expect(
      matchesToVoid([
        { id: 1, status: "completed", voidedAt: null },
        { id: 2, status: "scheduled", voidedAt: null },
        { id: 3, status: "scheduled", voidedAt: new Date() },
      ]),
    ).toEqual([2]);
  });
});

describe("ratingRangeLabel", () => {
  it("reads the range in words", () => {
    expect(ratingRangeLabel({ minRating: "3.0", maxRating: "4.0" })).toBe("3.0 to 4.0");
    expect(ratingRangeLabel({ minRating: "3.5", maxRating: null })).toBe("3.5 and up");
  });
});
