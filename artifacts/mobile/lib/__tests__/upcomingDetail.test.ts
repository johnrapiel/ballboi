import { describe, expect, it } from "vitest";

import type { MatchDetail } from "@workspace/api-client-react";

import { cardWhen } from "@/lib/upcoming";
import { upcomingActions, upcomingFromDetail } from "@/lib/upcomingDetail";

// Finding 9 (John, Nov 11): Match detail for a match not played yet shows
// Home's next-match card with its actions.

const now = new Date(2026, 10, 12, 8, 0); // Thu, Nov 12, 8:00 AM
const local = (day: number, h: number) => new Date(2026, 10, day, h, 0).toISOString();

const player = (playerId: number, name: string, o: Partial<MatchDetail["you"]["players"][number]> = {}) => ({
  playerId,
  name,
  you: false,
  hasAccount: true,
  avatarUrl: null,
  ...o,
});

const detail = (o: Partial<MatchDetail> = {}): MatchDetail =>
  ({
    matchId: 55,
    source: "league",
    leagueId: 3,
    leagueName: "Test League 1",
    context: "Test League 1",
    singles: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    roundNumber: 5,
    playoffRound: null,
    scheduledAt: null,
    completedAt: null,
    location: "Beacon Courts",
    played: false,
    voided: false,
    inGrace: false,
    lateUntil: null,
    score: null,
    you: { players: [player(1, "John Rapiel", { you: true })], won: false },
    opponents: { players: [player(2, "Marcus Hall", { avatarUrl: "/objects/m.jpg" })], won: false },
    ...o,
  }) as MatchDetail;

describe("upcomingFromDetail", () => {
  it("builds a singles league match with the opponent's face and Message target", () => {
    const m = upcomingFromDetail(detail({ scheduledAt: local(15, 10) }), "Test League 1 · Round 5", now);
    expect(m).toMatchObject({
      kind: "league",
      opponentName: "Marcus Hall",
      opponentPlayerId: 2,
      opponentPhoto: "/objects/m.jpg",
      partnerName: null,
      opponentNames: [],
      context: "Test League 1 · Round 5",
      location: "Beacon Courts",
      matchId: 55,
      leagueId: 3,
    });
    expect(cardWhen(m, now)).toEqual({ dateLabel: "Sunday, Nov 15", time: "10 AM" });
  });

  it("names both teams in doubles and has no single face", () => {
    const m = upcomingFromDetail(
      detail({
        singles: false,
        you: { players: [player(1, "John Rapiel", { you: true }), player(4, "Sam Lee")], won: false },
        opponents: { players: [player(2, "Jo Park"), player(3, "Lee Chan")], won: false },
      }),
      "Doubles League",
      now,
    );
    expect(m.partnerName).toBe("Sam Lee");
    expect(m.opponentNames).toEqual(["Jo Park", "Lee Chan"]);
    expect(m.opponentPlayerId).toBeNull();
    expect(m.opponentPhoto).toBeNull();
  });

  it("shows a late match's Play by date when its saved time has passed", () => {
    const m = upcomingFromDetail(detail({ scheduledAt: local(8, 10), lateUntil: "2026-11-13" }), "Test League 1", now);
    expect(m.grace).toBe(true);
    expect(m.scheduledAt).toBeNull();
    expect(cardWhen(m, now)).toEqual({ dateLabel: "Late match", time: "Play by Fri, Nov 13" });
  });

  it("treats playoff, Discover and Quick matches by where they came from", () => {
    expect(upcomingFromDetail(detail({ playoffRound: "semifinal" }), "x", now).kind).toBe("playoff");
    expect(upcomingFromDetail(detail({ source: "discover", leagueId: null }), "Discover", now).kind).toBe("discover");
    expect(upcomingFromDetail(detail({ source: "quick_match", leagueId: null }), "Quick match", now).kind).toBe("discover");
  });

  it("leaves Message off for an opponent with no account", () => {
    const m = upcomingFromDetail(detail({ opponents: { players: [player(2, "Marcus Hall", { hasAccount: false })], won: false } }), "x", now);
    expect(m.opponentPlayerId).toBeNull();
  });
});

describe("upcomingActions", () => {
  const base = { kind: "league" as const, matchId: 55, notStarted: false, singles: true, scheduledAt: null };

  it("singles league match: Record, Enter score and Match time where allowed", () => {
    expect(upcomingActions(base, { matchTimeAllowed: true, now })).toEqual({ record: true, doublesNote: false, enterScore: true, matchTime: true });
    expect(upcomingActions(base, { matchTimeAllowed: false, now }).matchTime).toBe(false);
  });

  it("doubles: no Record, the note instead", () => {
    expect(upcomingActions({ ...base, singles: false }, { matchTimeAllowed: true, now })).toEqual({ record: false, doublesNote: true, enterScore: true, matchTime: true });
  });

  it("a round that hasn't started has no actions", () => {
    expect(upcomingActions({ ...base, notStarted: true }, { matchTimeAllowed: true, now })).toEqual({ record: false, doublesNote: false, enterScore: false, matchTime: false });
  });

  it("playoff: no Match time", () => {
    expect(upcomingActions({ ...base, kind: "playoff" }, { matchTimeAllowed: true, now }).matchTime).toBe(false);
  });

  it("Discover: Record on match day only, no league actions", () => {
    const discover = { ...base, kind: "discover" as const };
    expect(upcomingActions({ ...discover, scheduledAt: local(12, 18) }, { matchTimeAllowed: true, now })).toEqual({ record: true, doublesNote: false, enterScore: false, matchTime: false });
    expect(upcomingActions({ ...discover, scheduledAt: local(14, 18) }, { matchTimeAllowed: true, now }).record).toBe(false);
  });
});
