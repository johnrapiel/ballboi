import { describe, it, expect } from "vitest";
import { buildMatchDetail, type DetailInput, type DetailMatch } from "../lib/matchDetail.js";

// Finding 6: Match detail. Finding 7: the 24-hour edit shows on it.

const now = new Date("2026-11-06T20:00:00Z");
const m = (over: Partial<DetailMatch> = {}): DetailMatch => ({
  id: 7, leagueId: 1, roundId: 3, player1Id: 10, player2Id: 20, player3Id: null, player4Id: null,
  status: "completed", score: "6-4, 7-5", winnerId: 10, inGrace: false, voidedAt: null,
  scheduledAt: "2026-11-06T18:00:00Z", completedAt: "2026-11-06T19:30:00Z", location: "Beacon Courts · Court 3",
  playoffBracketId: null, playoffRound: null, recordedAt: "2026-11-06T19:30:00Z", recordedByClerkUserId: "user_a",
  correctedAt: null, correctedByName: null, scoreEditedAt: null, scoreEditedByName: null, generatedFrom: "round", ...over,
});
const input = (over: Partial<DetailInput> = {}): DetailInput => ({
  match: m(),
  league: { id: 1, name: "Men's 3.5", leagueType: "singles", timeZone: "America/New_York" },
  players: [
    { id: 10, name: "John Rapiel", clerkUserId: "user_a" },
    { id: 20, name: "Ray Alvarez", clerkUserId: "user_b" },
  ],
  roundNumber: 3,
  userId: "user_a",
  replay: null,
  now,
  ...over,
});

describe("buildMatchDetail", () => {
  it("shows the score from your side with you first, and who won", () => {
    const mine = buildMatchDetail(input());
    expect(mine).toMatchObject({ score: "6-4, 7-5", played: true, you: { won: true }, opponents: { won: false }, enteredBy: "John Rapiel" });
    const theirs = buildMatchDetail(input({ userId: "user_b" }));
    expect(theirs).toMatchObject({ score: "4-6, 5-7", you: { won: false, players: [{ name: "Ray Alvarez", you: true }] }, opponents: { won: true } });
  });

  it("lets either player edit for 24 hours, then locks", () => {
    expect(buildMatchDetail(input()).editUntil).toBe("2026-11-07T19:30:00.000Z");
    expect(buildMatchDetail(input({ userId: "user_b" })).editUntil).toBe("2026-11-07T19:30:00.000Z");
    expect(buildMatchDetail(input({ now: new Date("2026-11-07T19:31:00Z") })).editUntil).toBeNull();
  });

  it("says who edited or corrected the score", () => {
    const edited = buildMatchDetail(input({ match: m({ scoreEditedAt: new Date("2026-11-06T21:00:00Z"), scoreEditedByName: "Ray Alvarez" }) }));
    expect(edited).toMatchObject({ editedBy: "Ray Alvarez", editedAt: "2026-11-06T21:00:00.000Z" });
    const corrected = buildMatchDetail(input({ match: m({ correctedAt: new Date(), correctedByName: "Dana" }) }));
    expect(corrected).toMatchObject({ correctedBy: "Dana", editUntil: null });
  });

  it("has no score, edit or winner before the match is played", () => {
    const out = buildMatchDetail(input({ match: m({ status: "scheduled", score: null, winnerId: null, recordedAt: null, recordedByClerkUserId: null }) }));
    expect(out).toMatchObject({ played: false, score: null, editUntil: null, enteredBy: null, you: { won: false }, opponents: { won: false } });
  });

  it("doesn't offer edits once the league has ended", () => {
    expect(buildMatchDetail(input({ league: { id: 1, name: "Men's 3.5", leagueType: "singles", endedAt: new Date() } })).editUntil).toBeNull();
  });

  it("carries the replay only when there is one", () => {
    expect(buildMatchDetail(input()).replay).toBeNull();
    expect(buildMatchDetail(input({ replay: { durationSeconds: 5520, shotCount: 412 } })).replay).toEqual({ durationSeconds: 5520, shotCount: 412 });
  });

  // Decision 152: a late match carries the last day to play it.
  describe("late matches", () => {
    const unplayed = m({ status: "scheduled", score: null, winnerId: null, recordedAt: null, recordedByClerkUserId: null });
    // Nov 6 in New York; the round's deadline was Nov 3, so its extra week runs to Nov 10.
    const round = { publishedAt: new Date("2026-10-27T11:00:00Z"), startDate: "2026-10-28", endDate: "2026-11-03" };

    it("gives the end of the extra week for an unplayed match past its deadline", () => {
      expect(buildMatchDetail(input({ match: unplayed, round })).lateUntil).toBe("2026-11-10");
    });

    it("is null while the round's week is still on, once played, or with no round", () => {
      expect(buildMatchDetail(input({ match: unplayed, round: { ...round, endDate: "2026-11-08" } })).lateUntil).toBeNull();
      expect(buildMatchDetail(input({ round })).lateUntil).toBeNull();
      expect(buildMatchDetail(input({ match: unplayed })).lateUntil).toBeNull();
    });

    it("is null after the extra week, for a cancelled match, or once the league has ended", () => {
      expect(buildMatchDetail(input({ match: unplayed, round: { ...round, endDate: "2026-10-29" } })).lateUntil).toBeNull();
      expect(buildMatchDetail(input({ match: m({ ...unplayed, voidedAt: new Date() }), round })).lateUntil).toBeNull();
      expect(buildMatchDetail(input({ match: unplayed, round, league: { id: 1, name: "Men's 3.5", leagueType: "singles", timeZone: "America/New_York", endedAt: new Date("2026-11-05T00:00:00Z") } })).lateUntil).toBeNull();
    });
  });
});
