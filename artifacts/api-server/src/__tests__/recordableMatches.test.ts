import { describe, expect, it } from "vitest";
import {
  byScheduledTime,
  isRecordableToday,
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
