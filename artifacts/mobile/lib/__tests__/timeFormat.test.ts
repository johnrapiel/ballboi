import { describe, expect, it } from "vitest";

import { BLOCKS, blockSpoken } from "../freeTimes";
import { planTime } from "../discover";
import { matchWhen, pairingTime, weeklyMatchTime } from "../leagueSchedule";
import { shortTime } from "../messages";
import { dayAndTime } from "../myMatches";
import { clockTime, hhmmTime, rangeText, timeText } from "../timeFormat";

// Spec decision 180 (John, Nov 11): one time format across the app.
describe("one time format (decision 180)", () => {
  it("drops :00, keeps minutes, a space and capitals before AM or PM", () => {
    expect(timeText(7 * 60)).toBe("7 AM");
    expect(timeText(18 * 60 + 30)).toBe("6:30 PM");
    expect(timeText(12 * 60)).toBe("12 PM");
    expect(timeText(0)).toBe("12 AM");
    expect(timeText(9 * 60 + 5)).toBe("9:05 AM");
  });

  it("reads a moment on the phone's clock", () => {
    expect(clockTime(new Date(2026, 10, 12, 7, 0))).toBe("7 AM");
    expect(clockTime(new Date(2026, 10, 12, 18, 30))).toBe("6:30 PM");
    expect(clockTime(new Date(2026, 10, 12, 0, 15))).toBe("12:15 AM");
  });

  it("reads a stored HH:MM", () => {
    expect(hhmmTime("18:30")).toBe("6:30 PM");
    expect(hhmmTime("07:00")).toBe("7 AM");
    expect(hhmmTime("18:30:00")).toBe("6:30 PM");
    expect(hhmmTime("")).toBeNull();
    expect(hhmmTime("25:00")).toBeNull();
    expect(hhmmTime(null)).toBeNull();
  });

  it("says AM or PM once when a range stays on one side of noon", () => {
    expect(rangeText({ start: 7 * 60, end: 11 * 60 })).toBe("7 to 11 AM");
    expect(rangeText({ start: 12 * 60, end: 16 * 60 })).toBe("12 to 4 PM");
    expect(rangeText({ start: 18 * 60 + 30, end: 20 * 60 })).toBe("6:30 to 8 PM");
  });

  it("says both when a range crosses noon or ends at midnight", () => {
    expect(rangeText({ start: 10 * 60, end: 12 * 60 })).toBe("10 AM to 12 PM");
    expect(rangeText({ start: 11 * 60, end: 13 * 60 })).toBe("11 AM to 1 PM");
    expect(rangeText({ start: 22 * 60, end: 24 * 60 })).toBe("10 PM to 12 AM");
  });
});

describe("times the app shows use it", () => {
  it("pairings go out at 7 AM", () => {
    expect(pairingTime(null)).toBe("7 AM");
  });

  it("match times read 6:30 PM, and 6 PM without :00", () => {
    const now = new Date(2026, 10, 12, 9, 0);
    expect(matchWhen(new Date(2026, 10, 12, 18, 30).toISOString(), now)).toBe("Today at 6:30 PM");
    expect(matchWhen(new Date(2026, 10, 13, 18, 0).toISOString(), now)).toBe("Fri, Nov 13 at 6 PM");
    expect(weeklyMatchTime(2, "18:30")).toBe("Tuesdays at 6:30 PM");
    expect(weeklyMatchTime(6, "07:00")).toBe("Saturdays at 7 AM");
    expect(planTime(new Date(2026, 10, 12, 18, 30).toISOString())).toBe("6:30 PM");
    expect(dayAndTime(new Date(2026, 10, 7, 19, 41).toISOString())).toBe("Nov 7 at 7:41 PM");
  });

  it("free time pills and chat times say AM or PM", () => {
    expect(blockSpoken(BLOCKS[0], 1)).toBe("Morning, 7 to 11 AM, Tuesday");
    const now = new Date(2026, 10, 12, 20, 0);
    expect(shortTime(new Date(2026, 10, 12, 17, 2).toISOString(), now)).toBe("5:02 PM");
    expect(shortTime(new Date(2026, 10, 12, 17, 0).toISOString(), now)).toBe("5 PM");
  });
});
