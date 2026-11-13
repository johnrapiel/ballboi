import { describe, expect, it } from "vitest";

import { cardLead, heroIndex, isPastDue, matchZone, PAST_DUE_AFTER_MS } from "@/lib/matchTiming";
import { cardWhen, rowSpoken, rowWhen } from "@/lib/upcoming";
import { upcomingActions } from "@/lib/upcomingDetail";

// Wave 2 finding 47 (John, Nov 12): an hour after a match's set start with no
// score it reads "Earlier today", Enter score leads and Record becomes a link.
// The next day the late-match and "Did it happen?" flows take over.

// Local (phone) times: Thu, Nov 12, 2026.
const at = (h: number, min = 0, day = 12) => new Date(2026, 10, day, h, min);
const start = at(18, 30).toISOString(); // 6:30 PM
const tonight = at(20, 45); // 8:45 PM, when John took the screenshot

describe("isPastDue", () => {
  it("is past due more than an hour after the start with no score", () => {
    expect(isPastDue({ scheduledAt: start }, tonight)).toBe(true);
  });

  it("is not past due at exactly one hour, and is a moment later", () => {
    const oneHour = new Date(new Date(start).getTime() + PAST_DUE_AFTER_MS);
    expect(isPastDue({ scheduledAt: start }, oneHour)).toBe(false);
    expect(isPastDue({ scheduledAt: start }, new Date(oneHour.getTime() + 1))).toBe(true);
  });

  it("is not past due before the start or within its first hour", () => {
    expect(isPastDue({ scheduledAt: start }, at(17))).toBe(false);
    expect(isPastDue({ scheduledAt: start }, at(19, 15))).toBe(false);
  });

  it("needs a set time", () => {
    expect(isPastDue({ scheduledAt: null }, tonight)).toBe(false);
    expect(isPastDue({}, tonight)).toBe(false);
    expect(isPastDue({ scheduledAt: "not a time" }, tonight)).toBe(false);
  });

  it("never once there's a score", () => {
    expect(isPastDue({ scheduledAt: start, score: "6-3, 6-4" }, tonight)).toBe(false);
    expect(isPastDue({ scheduledAt: start, played: true }, tonight)).toBe(false);
  });

  it("hands off the next day (Did it happen? and the late-match flow take over)", () => {
    expect(isPastDue({ scheduledAt: start }, at(9, 0, 13))).toBe(false);
  });

  it("judges the day in the league's time zone", () => {
    // 11 PM in Los Angeles on Nov 12 is 7 AM UTC on Nov 13.
    const late = "2026-11-13T07:00:00.000Z";
    const later = new Date("2026-11-13T08:30:00.000Z"); // 12:30 AM Nov 13 in Los Angeles
    // In Los Angeles it's already the next day: not past due, the next-day flow has it.
    expect(isPastDue({ scheduledAt: late, timeZone: "America/Los_Angeles" }, later)).toBe(false);
    // In a league on UTC it's the same day, 90 minutes on: past due.
    expect(isPastDue({ scheduledAt: late, timeZone: "Etc/UTC" }, later)).toBe(true);
  });

  it("falls back to the phone's zone when the league's isn't a real one", () => {
    expect(matchZone("Mars/Olympus")).toBeUndefined();
    expect(matchZone(null)).toBeUndefined();
    expect(matchZone("America/New_York")).toBe("America/New_York");
    expect(isPastDue({ scheduledAt: start, timeZone: "Mars/Olympus" }, tonight)).toBe(true);
  });
});

describe("the words", () => {
  const item = { scheduledAt: start, playBy: null, starts: null };

  it("Home's card and rows read Earlier today with the time (decision 180)", () => {
    expect(cardWhen(item, tonight)).toEqual({ dateLabel: "Earlier today", time: "6:30 PM" });
    expect(rowWhen(item, tonight)).toBe("Earlier today · 6:30 PM");
  });

  it("still reads Today within the first hour", () => {
    expect(cardWhen(item, at(19)).dateLabel).toBe("Today");
    expect(rowWhen(item, at(19))).toBe("Today · 6:30 PM");
  });

  it("VoiceOver hears Earlier today", () => {
    const row = { ...item, kind: "league" as const, opponentName: "Elena Ortiz", context: "Test League 1", singles: true, openStatus: null, location: "Memorial Park, Beacon" };
    expect(rowSpoken(row, tonight)).toBe("Earlier today, 6:30 PM. Versus Elena Ortiz at Memorial Park, Beacon. Test League 1");
  });

  it("a late match with a time ahead says Late match to VoiceOver too", () => {
    const row = { scheduledAt: at(10, 0, 14).toISOString(), playBy: "Sun, Nov 15", starts: null, grace: true, kind: "league" as const, opponentName: "Mike", context: "Flex", singles: true, openStatus: null, location: null };
    expect(rowSpoken(row, tonight)).toMatch(/^Late match, Saturday/);
  });
});

describe("cardLead", () => {
  it("Record leads before; it's a link once past due", () => {
    expect(cardLead({ scheduledAt: start }, { canRecord: true, now: at(18) })).toEqual({ pastDue: false, record: "button" });
    expect(cardLead({ scheduledAt: start }, { canRecord: true, now: tonight })).toEqual({ pastDue: true, record: "link" });
  });

  it("doubles, where Record is off, has no Record link either", () => {
    expect(cardLead({ scheduledAt: start }, { canRecord: false, now: tonight })).toEqual({ pastDue: true, record: null });
  });
});

describe("Match detail actions", () => {
  const league = { kind: "league" as const, matchId: 9, notStarted: false, singles: true, scheduledAt: start };

  it("past due: Enter score leads, Record stays as a link", () => {
    expect(upcomingActions(league, { matchTimeAllowed: false, now: tonight })).toMatchObject({ pastDue: true, record: true, enterScore: true });
  });

  it("doubles past due: Enter score, no Record and no doubles note", () => {
    expect(upcomingActions({ ...league, singles: false }, { matchTimeAllowed: false, now: tonight })).toMatchObject({
      pastDue: true,
      record: false,
      doublesNote: false,
      enterScore: true,
    });
  });

  it("a Discover match past due offers Enter score on the card", () => {
    expect(upcomingActions({ ...league, kind: "discover" }, { matchTimeAllowed: false, now: tonight })).toMatchObject({ pastDue: true, record: true, enterScore: true });
  });

  it("the next day it's back to the usual card", () => {
    expect(upcomingActions(league, { matchTimeAllowed: false, now: at(9, 0, 13) })).toMatchObject({ pastDue: false });
  });
});

describe("heroIndex", () => {
  const m = (h: number, day = 12, kind = "league") => ({ scheduledAt: at(h, 0, day).toISOString(), kind });

  it("a match still ahead today leads over a past-due one", () => {
    expect(heroIndex([m(18), m(21)], tonight)).toBe(1);
  });

  it("a match in its first hour also leads over a past-due one", () => {
    expect(heroIndex([m(17), m(20)], tonight)).toBe(1);
  });

  it("a past-due match stays the hero when it's the only one today", () => {
    expect(heroIndex([m(18), m(10, 13)], tonight)).toBe(0);
    expect(heroIndex([m(18)], tonight)).toBe(0);
  });

  it("skips matches that can't lead", () => {
    expect(heroIndex([m(18), m(21, 12, "open")], tonight, (x) => x.kind !== "open")).toBe(0);
    expect(heroIndex([], tonight)).toBe(-1);
  });
});
