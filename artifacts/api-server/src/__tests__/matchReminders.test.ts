import { describe, expect, it } from "vitest";
import { dueForTimedMatch, nudgeSunday, reminderCopy, remindedUserIds, wantsWeekNudge } from "../lib/matchReminders";

// Match day reminders: one rule everywhere (Session G acceptance 27 to 30; decision 127).

const NY = "America/New_York";
const LA = "America/Los_Angeles";
// Tuesday Nov 10, 2026, 6 PM in New York (23:00 UTC).
const match = { id: 1, scheduledAt: new Date("2026-11-10T23:00:00Z"), timeZone: NY };

describe("dueForTimedMatch", () => {
  it("sends the day-before reminder at 8 AM on the match's clock, the day before (27)", () => {
    // Monday 8:05 AM in New York.
    expect(dueForTimedMatch(match, new Date("2026-11-09T13:05:00Z"))).toEqual([{ matchId: 1, type: "day_before_match", key: "2026-11-10" }]);
    // 7:55 AM and 9:00 AM: not yet, and too late.
    expect(dueForTimedMatch(match, new Date("2026-11-09T12:55:00Z"))).toEqual([]);
    expect(dueForTimedMatch(match, new Date("2026-11-09T14:00:00Z"))).toEqual([]);
    // 8 AM on the match day itself isn't the day before.
    expect(dueForTimedMatch(match, new Date("2026-11-10T13:05:00Z"))).toEqual([]);
  });

  it("uses the match's own clock, not the server's", () => {
    const west = { ...match, scheduledAt: new Date("2026-11-11T02:00:00Z"), timeZone: LA }; // Tue 6 PM in LA
    expect(dueForTimedMatch(west, new Date("2026-11-09T16:05:00Z"))).toEqual([{ matchId: 1, type: "day_before_match", key: "2026-11-10" }]);
    expect(dueForTimedMatch(west, new Date("2026-11-09T13:05:00Z"))).toEqual([]);
  });

  it("sends one 2 hours before, until the match starts (27, 28)", () => {
    expect(dueForTimedMatch(match, new Date("2026-11-10T20:59:00Z"))).toEqual([]);
    expect(dueForTimedMatch(match, new Date("2026-11-10T21:00:00Z"))).toEqual([{ matchId: 1, type: "two_hours_before", key: "2026-11-10T23:00:00.000Z" }]);
    // A match added an hour before still gets it.
    expect(dueForTimedMatch(match, new Date("2026-11-10T22:00:00Z"))).toHaveLength(1);
    expect(dueForTimedMatch(match, new Date("2026-11-10T23:00:00Z"))).toEqual([]);
  });

  it("keys each reminder so the log claims it once, and a new time reminds again", () => {
    const now = new Date("2026-11-10T21:30:00Z");
    const first = dueForTimedMatch(match, now);
    expect(dueForTimedMatch(match, new Date("2026-11-10T21:35:00Z"))).toEqual(first);
    const moved = dueForTimedMatch({ ...match, scheduledAt: new Date("2026-11-10T23:30:00Z") }, now);
    expect(moved[0]?.key).not.toBe(first[0]?.key);
  });
});

describe("Sunday nudge (29)", () => {
  it("is due Sunday at 9 AM on the league's clock only", () => {
    expect(nudgeSunday(new Date("2026-11-08T14:10:00Z"), NY)).toBe("2026-11-08"); // Sun 9:10 AM
    expect(nudgeSunday(new Date("2026-11-08T13:10:00Z"), NY)).toBeNull(); // Sun 8:10 AM
    expect(nudgeSunday(new Date("2026-11-09T14:10:00Z"), NY)).toBeNull(); // Monday
  });

  it("covers a published round running into the coming week", () => {
    const sunday = "2026-11-08";
    expect(wantsWeekNudge({ startDate: "2026-11-09", endDate: "2026-11-15", published: true }, sunday)).toBe(true);
    expect(wantsWeekNudge({ startDate: "2026-11-02", endDate: "2026-11-14", published: true }, sunday)).toBe(true);
    expect(wantsWeekNudge({ startDate: "2026-11-09", endDate: "2026-11-15", published: false }, sunday)).toBe(false);
    expect(wantsWeekNudge({ startDate: "2026-11-02", endDate: "2026-11-08", published: true }, sunday)).toBe(false);
    expect(wantsWeekNudge({ startDate: "2026-11-23", endDate: "2026-11-29", published: true }, sunday)).toBe(false);
  });
});

describe("remindedUserIds (30)", () => {
  it("leaves out anyone who turned Match day reminders off, placeholders, and repeats", () => {
    const players = [{ clerkUserId: "a" }, { clerkUserId: "b" }, { clerkUserId: null }, { clerkUserId: "a" }, null];
    expect(remindedUserIds(players, new Set())).toEqual(["a", "b"]);
    expect(remindedUserIds(players, new Set(["b"]))).toEqual(["a"]);
  });

  it("still honors the older per-league switch", () => {
    expect(remindedUserIds([{ clerkUserId: "a", dayBeforeMatchReminderEnabled: false }], new Set())).toEqual([]);
  });
});

describe("reminderCopy", () => {
  it("names the opponent, the time on the match's clock and the place", () => {
    const at = match.scheduledAt;
    expect(reminderCopy("day_before_match", { opponents: "Sam Whitfield", at, timeZone: NY, place: "Riverside Park" })).toEqual({
      title: "Match tomorrow",
      body: "vs Sam Whitfield, 6 PM at Riverside Park.",
    });
    expect(reminderCopy("two_hours_before", { opponents: "Sam Whitfield", at, timeZone: NY, place: null })).toEqual({
      title: "Your match is in 2 hours",
      body: "vs Sam Whitfield, 6 PM.",
    });
    expect(reminderCopy("week_nudge", { opponents: "Sam Whitfield", at: null, timeZone: NY, place: null, byDate: "2026-11-15" })).toEqual({
      title: "Your match this week",
      body: "vs Sam Whitfield. Set a time together by Sun, Nov 15.",
    });
  });
});
