import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  countAt,
  filterChips,
  freeTimesLine,
  levelRangeLabel,
  playerLine,
  playerSpoken,
  radiusOption,
  readSavedFilters,
  toggleFreeTime,
  widerRadius,
} from "../discover";

const counts = [
  { radius: 5, count: 0 },
  { radius: 10, count: 0 },
  { radius: 15, count: 4 },
  { radius: 30, count: 9 },
];

describe("Discover filters", () => {
  it("words the level range around your own level", () => {
    expect(levelRangeLabel("near", 3.5)).toBe("3.0 to 4.0");
    expect(levelRangeLabel("wider", 3.5)).toBe("2.5 to 4.5");
    expect(levelRangeLabel("near", 1.0)).toBe("1.0 to 1.5");
    expect(levelRangeLabel("any", 3.5)).toBe("Any level");
    expect(levelRangeLabel("near", null)).toBe("Any level");
  });

  it("shows the canvas chips, leaving out any", () => {
    expect(filterChips(DEFAULT_FILTERS, 3.5)).toEqual(["Within 10 mi", "3.0 to 4.0"]);
    expect(filterChips({ radius: 15, level: "any", plays: "singles", free: "weekends" }, 3.5)).toEqual([
      "Within 15 mi",
      "Any level",
      "Singles",
      "Weekends",
    ]);
  });

  it("counts each radius step and finds the next one with players", () => {
    expect(countAt(counts, 15)).toBe(4);
    expect(countAt([], 15)).toBeNull();
    expect(radiusOption(15, 4)).toEqual({ label: "15 mi · 4", spoken: "Within 15 miles, 4 players" });
    expect(radiusOption(5, 1).spoken).toBe("Within 5 miles, 1 player");
    expect(widerRadius(counts, 10)).toEqual({ radius: 15, count: 4 });
    expect(widerRadius(counts, 30)).toBeNull();
  });

  it("falls back to the defaults for anything saved that it doesn't know", () => {
    expect(readSavedFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(readSavedFilters("not json")).toEqual(DEFAULT_FILTERS);
    expect(readSavedFilters(JSON.stringify({ radius: 15, level: "wider", plays: "doubles", free: "weekends" }))).toEqual({
      radius: 15,
      level: "wider",
      plays: "doubles",
      free: "weekends",
    });
    expect(readSavedFilters(JSON.stringify({ radius: 100, level: "x", plays: "both", free: 3 }))).toEqual(DEFAULT_FILTERS);
  });
});

describe("Discover players", () => {
  const p = { name: "Dana Lindqvist", rating: 3.5, distanceLabel: "~2 mi away", played: 12 };

  it("shows level, approximate distance and matches played", () => {
    expect(playerLine(p)).toBe("3.5 · ~2 mi away · Played 12");
    expect(playerLine({ ...p, rating: null })).toBe("Level not set · ~2 mi away · Played 12");
  });

  it("reads a row to VoiceOver in words", () => {
    expect(playerSpoken(p)).toBe("Dana Lindqvist, level 3.5, about 2 miles away, played 12 matches");
    expect(playerSpoken({ ...p, distanceLabel: "~1 mi away", played: 1 })).toBe(
      "Dana Lindqvist, level 3.5, about 1 mile away, played 1 match",
    );
    expect(playerSpoken({ ...p, rating: null, distanceLabel: "Under 1 mi away" })).toBe(
      "Dana Lindqvist, level not set, under 1 mile away, played 12 matches",
    );
  });

  it("keeps usually-free times in the listed order", () => {
    expect(toggleFreeTime(["weekends"], "weekday_mornings")).toEqual(["weekday_mornings", "weekends"]);
    expect(toggleFreeTime(["weekday_mornings", "weekends"], "weekends")).toEqual(["weekday_mornings"]);
    expect(freeTimesLine([])).toBeNull();
    expect(freeTimesLine(["weekends"])).toBe("Weekends");
    expect(freeTimesLine(["weekends", "weekday_evenings"])).toBe("Weekday evenings and weekends");
    expect(freeTimesLine(["weekday_mornings", "weekday_evenings", "weekends"])).toBe(
      "Weekday mornings, weekday evenings and weekends",
    );
  });
});
