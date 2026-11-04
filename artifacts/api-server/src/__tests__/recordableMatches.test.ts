import { describe, expect, it } from "vitest";
import {
  byScheduledTime,
  isRecordableNow,
  isRecordableToday,
  recordListOrder,
  type RecordContext,
  parseWhen,
  recordingStage,
  toRecordableMatch,
  type MatchRow,
} from "../lib/recordableMatches";

const from = new Date("2026-10-29T04:00:00.000Z");
const to = new Date("2026-10-30T04:00:00.000Z");

function match(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 1,
    leagueId: 7,
    player1Id: 10,
    player2Id: 20,
    player3Id: null,
    player4Id: null,
    status: "scheduled",
    scheduledAt: "2026-10-29T22:00:00.000Z",
    location: "Memorial Park",
    ...over,
  };
}

const names = { 10: "John Rapiel", 20: "Alex Kim", 30: "Sam Lee", 40: "Pat Ruiz" };
const leagues = { 7: "Tuesday Flex" };

describe("isRecordableToday", () => {
  it("includes an unplayed match inside the window", () => {
    expect(isRecordableToday(match(), from, to)).toBe(true);
  });

  it("leaves out played, cancelled and unscheduled matches", () => {
    expect(isRecordableToday(match({ status: "completed" }), from, to)).toBe(false);
    expect(isRecordableToday(match({ status: "cancelled" }), from, to)).toBe(false);
    expect(isRecordableToday(match({ scheduledAt: null }), from, to)).toBe(false);
    expect(isRecordableToday(match({ scheduledAt: "not a date" }), from, to)).toBe(false);
  });

  it("treats the window as [from, to)", () => {
    expect(isRecordableToday(match({ scheduledAt: from.toISOString() }), from, to)).toBe(true);
    expect(isRecordableToday(match({ scheduledAt: to.toISOString() }), from, to)).toBe(false);
  });
});

describe("toRecordableMatch", () => {
  it("names the opponent from either side", () => {
    expect(toRecordableMatch(match(), [10], names, leagues)).toMatchObject({
      format: "singles",
      opponentName: "Alex Kim",
      partnerName: null,
      leagueName: "Tuesday Flex",
    });
    expect(toRecordableMatch(match(), [20], names, leagues)?.opponentName).toBe("John Rapiel");
  });

  it("marks doubles and names both opponents and the partner", () => {
    const d = match({ player3Id: 30, player4Id: 40 });
    expect(toRecordableMatch(d, [10], names, leagues)).toMatchObject({
      format: "doubles",
      opponentName: "Alex Kim and Pat Ruiz",
      partnerName: "Sam Lee",
    });
  });

  it("returns null when the viewer isn't in the match", () => {
    expect(toRecordableMatch(match(), [99], names, leagues)).toBeNull();
  });

  it("has no league name for a Quick match", () => {
    expect(toRecordableMatch(match({ leagueId: null }), [10], names, leagues)?.leagueName).toBeNull();
  });
});

describe("byScheduledTime and parseWhen", () => {
  it("sorts earliest first with untimed matches last", () => {
    const a = toRecordableMatch(match({ id: 1, scheduledAt: "2026-10-29T22:00:00Z" }), [10], names, leagues)!;
    const b = toRecordableMatch(match({ id: 2, scheduledAt: "2026-10-29T14:00:00Z" }), [10], names, leagues)!;
    const c = { ...a, id: 3, scheduledAt: null };
    expect([a, c, b].sort(byScheduledTime).map((m) => m.id)).toEqual([2, 1, 3]);
  });

  it("parses only real dates", () => {
    expect(parseWhen("2026-10-29T04:00:00.000Z")?.toISOString()).toBe("2026-10-29T04:00:00.000Z");
    expect(parseWhen("nope")).toBeNull();
    expect(parseWhen(undefined)).toBeNull();
  });
});

describe("recordingStage", () => {
  it("maps session statuses to the processing card", () => {
    expect(recordingStage("recording", "pending")).toBe("uploading");
    expect(recordingStage("processing", "processing")).toBe("analyzing");
    expect(recordingStage("completed", "completed")).toBe("ready");
    expect(recordingStage("failed", "failed")).toBe("failed");
  });
});

// PR 4: any unplayed league match this week can be recorded; a set time only
// moves it to the top on its day.
describe("isRecordableNow", () => {
  const pub = new Date("2026-11-01T12:00:00Z");
  const ctx = (over: Partial<RecordContext> = {}): RecordContext => ({
    now: new Date("2026-11-04T17:00:00Z"),
    from: new Date("2026-11-04T05:00:00Z"),
    to: new Date("2026-11-05T05:00:00Z"),
    rounds: new Map([
      [1, { startDate: "2026-11-02", endDate: "2026-11-08", publishedAt: pub }], // this week
      [0, { startDate: "2026-10-26", endDate: "2026-11-01", publishedAt: pub }], // grace week
      [9, { startDate: "2026-10-12", endDate: "2026-10-18", publishedAt: pub }], // over
      [2, { startDate: "2026-11-09", endDate: "2026-11-15", publishedAt: null }], // draft
    ]),
    leagues: new Map([[7, { name: "Tuesday Flex", timeZone: "America/New_York", endedAt: null }]]),
    activeBrackets: new Set([3]),
    ...over,
  });
  const lm = (over: Partial<MatchRow>) => match({ scheduledAt: null, roundId: 1, score: null, voidedAt: null, ...over });

  it("includes an unscheduled match this week and in the grace week", () => {
    expect(isRecordableNow(lm({}), ctx())).toBe(true);
    expect(isRecordableNow(lm({ roundId: 0 }), ctx())).toBe(true);
  });

  it("doesn't need the set time to be today", () => {
    expect(isRecordableNow(lm({ scheduledAt: "2026-11-07T23:00:00.000Z" }), ctx())).toBe(true);
  });

  it("leaves out scored, cancelled, closed, draft and ended-league matches", () => {
    expect(isRecordableNow(lm({ score: "6-3, 6-4" }), ctx())).toBe(false);
    expect(isRecordableNow(lm({ status: "completed" }), ctx())).toBe(false);
    expect(isRecordableNow(lm({ voidedAt: new Date() }), ctx())).toBe(false);
    expect(isRecordableNow(lm({ roundId: 9 }), ctx())).toBe(false);
    expect(isRecordableNow(lm({ roundId: 2 }), ctx())).toBe(false);
    const ended = ctx({ leagues: new Map([[7, { name: "Tuesday Flex", timeZone: null, endedAt: new Date() }]]) });
    expect(isRecordableNow(lm({}), ended)).toBe(false);
  });

  it("uses the league's time zone for this week", () => {
    // 06:00 UTC Nov 9 is 1 AM Monday in New York but still 10 PM Sunday in Los Angeles,
    // so a round starting Nov 9 is open in New York and not yet in Los Angeles.
    const rounds = new Map([[5, { startDate: "2026-11-09", endDate: "2026-11-15", publishedAt: pub }]]);
    const now = new Date("2026-11-09T06:00:00Z");
    expect(isRecordableNow(lm({ roundId: 5 }), ctx({ now, rounds }))).toBe(true);
    const la = new Map([[7, { name: "Tuesday Flex", timeZone: "America/Los_Angeles", endedAt: null }]]);
    expect(isRecordableNow(lm({ roundId: 5 }), ctx({ now, rounds, leagues: la }))).toBe(false);
  });

  it("includes playoff matches while the bracket is on, and Quick matches only on their day", () => {
    expect(isRecordableNow(lm({ roundId: null, playoffBracketId: 3 }), ctx())).toBe(true);
    expect(isRecordableNow(lm({ roundId: null, playoffBracketId: 4 }), ctx())).toBe(false);
    expect(isRecordableNow(match({ leagueId: null, scheduledAt: "2026-11-04T22:00:00.000Z" }), ctx())).toBe(true);
    expect(isRecordableNow(match({ leagueId: null, scheduledAt: "2026-11-05T22:00:00.000Z" }), ctx())).toBe(false);
  });

  it("puts a match with a set time today first", () => {
    const c = ctx();
    const a = { ...toRecordableMatch(lm({ id: 1 }), [10], names, leagues)! };
    const b = { ...toRecordableMatch(lm({ id: 2, scheduledAt: "2026-11-06T23:00:00.000Z" }), [10], names, leagues)! };
    const t = { ...toRecordableMatch(lm({ id: 3, scheduledAt: "2026-11-04T23:00:00.000Z" }), [10], names, leagues)! };
    expect([a, b, t].sort(recordListOrder(c.from, c.to)).map((m) => m.id)).toEqual([3, 2, 1]);
  });
});
