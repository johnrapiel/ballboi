import { describe, it, expect } from "vitest";
import { approveOutcome, joinedWeek, joinOutcome, matchesToVoid, PRIVATE_REQUEST_MESSAGE, ratingRangeLabel } from "../lib/leagueJoining.js";

// Spec: Leagues > Joining and leaving (decisions 26, 27, 30); Discover > Joining an Open league.

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

  it("waitlists an Open league once the season starts", () => {
    const out = joinOutcome({ league: open, activePlayerCount: 3, today: "2026-11-05", via: "invite" });
    expect(out.kind).toBe("waitlist");
    if (out.kind === "waitlist") expect(out.reason).toMatch(/waitlist for next season/);
  });

  it("waitlists a full Open league", () => {
    const out = joinOutcome({ league: open, activePlayerCount: 8, today: "2026-11-01", via: "invite" });
    expect(out.kind).toBe("waitlist");
  });

  it("turns a Private code entered after the start into a join request (decision 30)", () => {
    expect(joinOutcome({ league: priv, activePlayerCount: 3, today: "2026-11-05", via: "invite" })).toEqual({
      kind: "request",
      reason: PRIVATE_REQUEST_MESSAGE,
    });
  });

  it("asks the organizer when a Private league is full, never a waitlist", () => {
    const out = joinOutcome({ league: { ...priv, rosterCap: 4 }, activePlayerCount: 4, today: "2026-11-01", via: "invite" });
    expect(out.kind).toBe("request");
    if (out.kind === "request") expect(out.reason).toMatch(/full/);
  });

  it("keeps Private leagues invite-only", () => {
    expect(joinOutcome({ league: priv, activePlayerCount: 3, today: "2026-11-01", via: "request" })).toMatchObject({
      kind: "refuse",
      status: 403,
    });
  });

  it("lets a player outside an Open league's level range ask; the organizer decides", () => {
    const out = joinOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", via: "request", skillLevel: "4.5" });
    expect(out).toEqual({ kind: "request" });
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

  it("approves a Private request mid-season (decision 30)", () => {
    expect(approveOutcome({ league: priv, activePlayerCount: 3, today: "2026-11-20", request })).toEqual({ ok: true });
  });

  it("refuses a request that was already handled", () => {
    expect(
      approveOutcome({ league: open, activePlayerCount: 3, today: "2026-11-01", request: { ...request, status: "declined" } }),
    ).toMatchObject({ ok: false });
  });
});

describe("joinedWeek", () => {
  it("is null for someone who joined before the season", () => {
    expect(joinedWeek("2026-11-05", "2026-11-01", 8)).toBeNull();
  });
  it("counts weeks from the season start (C3)", () => {
    expect(joinedWeek("2026-11-05", "2026-11-05", 8)).toBe(1);
    expect(joinedWeek("2026-11-05", "2026-11-18", 8)).toBe(2);
    expect(joinedWeek("2026-11-05", "2026-11-19", 8)).toBe(3);
  });
  it("never passes the last week", () => {
    expect(joinedWeek("2026-11-05", "2027-03-01", 8)).toBe(8);
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

describe("approveOutcome: D4 doubles let-in", () => {
  const open = { startDate: "2026-11-05", visibility: "open", rosterCap: 8, minRating: null, maxRating: null };
  it("lets a waitlisted player in mid-season when a fixed-partner team needs a partner, and only then", () => {
    const request = { kind: "waitlist", status: "pending" };
    expect(approveOutcome({ league: open, activePlayerCount: 7, today: "2026-11-20", request, letInForPartner: true })).toEqual({ ok: true });
    expect(approveOutcome({ league: open, activePlayerCount: 7, today: "2026-11-20", request })).toMatchObject({ ok: false });
    expect(approveOutcome({ league: open, activePlayerCount: 7, today: "2026-11-20", request: { ...request, status: "declined" }, letInForPartner: true })).toMatchObject({ ok: false });
  });
});
