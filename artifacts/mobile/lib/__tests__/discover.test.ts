import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  areaLine,
  cardStatsSpoken,
  cellAt,
  cellSpoken,
  clampRadius,
  countLine,
  filtersSpoken,
  hourShort,
  hoursFreeLine,
  initials,
  inviteMessage,
  isCustomRadius,
  levelRangeText,
  paintSlot,
  picksFromPlays,
  playersPath,
  playsFromPicks,
  radiusChipSpoken,
  rowDetail,
  rowSlots,
  sameSlots,
  slotOf,
  toggleRow,
  toggleSlot,
  whereLine,
} from "../discover";

describe("Discover header and chips", () => {
  it("names your area and the count", () => {
    expect(areaLine({ zip: "12590", town: "Wappingers Falls", state: "NY" })).toBe("Near 12590, Wappingers Falls");
    expect(countLine(14, 10)).toBe("14 players within 10 mi");
    expect(countLine(1, 5)).toBe("1 player within 5 mi");
    expect(countLine(3, 10, "open match")).toBe("3 open matches within 10 mi");
  });

  it("reads a count chip the way the brief says (finding 5)", () => {
    expect(radiusChipSpoken(10, 14, true)).toBe("10 miles, 14 players, selected");
    expect(radiusChipSpoken(1, 1, false)).toBe("1 mile, 1 player");
    expect(radiusChipSpoken(5, null, false)).toBe("5 miles");
  });

  it("keeps a custom distance to whole miles from 1 to 30", () => {
    expect(clampRadius(0)).toBe(1);
    expect(clampRadius(42)).toBe(30);
    expect(clampRadius(12.4)).toBe(12);
    expect(isCustomRadius(12)).toBe(true);
    expect(isCustomRadius(15)).toBe(false);
  });

  it("asks for players with the filters", () => {
    expect(playersPath(10, DEFAULT_FILTERS)).toBe("/api/discover/players?radius=10&level=close&plays=either");
    expect(playersPath(99, { level: "any", plays: "doubles", free: true })).toBe(
      "/api/discover/players?radius=30&level=any&plays=doubles&free=1",
    );
  });

  it("spells out the level range", () => {
    expect(levelRangeText(3.5, "close")).toBe("Level 3.0 to 4.0. You're 3.5.");
    expect(levelRangeText(3.5, "wider")).toBe("Level 2.5 to 4.5. You're 3.5.");
    expect(levelRangeText(null, "close")).toMatch(/Add your level/);
  });

  it("reads the Filters button", () => {
    expect(filtersSpoken(DEFAULT_FILTERS)).toBe("level close to mine, plays either, free when I'm free off");
  });

  it("fills the invite message", () => {
    expect(inviteMessage("12590")).toBe(
      "Play tennis with me on Ball Boi. I'm finding matches near 12590. Join me so we can play: https://ballboi.tennis",
    );
  });
});

describe("rows and the player card", () => {
  it("shows distance and plays, never free times (F14)", () => {
    expect(rowDetail({ distance: "~4 mi", plays: "singles" })).toBe("~4 mi · Singles");
    expect(rowDetail({ distance: "~2 mi", plays: "both" })).toBe("~2 mi · Singles and doubles");
    expect(rowDetail({ distance: "~7 mi", plays: null })).toBe("~7 mi");
  });

  it("reads the stats box as one group", () => {
    expect(cardStatsSpoken({ wins: 9, losses: 5, played: 14, noShows: 1 })).toBe("Record 9 wins 5 losses. Played 14, 1 no-show");
    expect(cardStatsSpoken({ wins: 1, losses: 1, played: 2, noShows: 0 })).toBe("Record 1 win 1 loss. Played 2, 0 no-shows");
  });

  it("says where, approximately", () => {
    expect(whereLine({ town: "Fishkill", distance: "~4 mi away" })).toBe("Fishkill · ~4 mi away");
    expect(whereLine({ town: null, distance: null })).toBeNull();
  });

  it("maps the I play chips", () => {
    expect(playsFromPicks(true, true)).toBe("both");
    expect(playsFromPicks(false, false)).toBeNull();
    expect(picksFromPlays("doubles")).toEqual({ singles: false, doubles: true });
  });

  it("makes initials", () => {
    expect(initials("Sam Whitfield")).toBe("SW");
    expect(initials("Cher")).toBe("C");
  });
});

describe("the hour grid (F7)", () => {
  it("labels hours and cells", () => {
    expect(hourShort(6)).toBe("6a");
    expect(hourShort(12)).toBe("12p");
    expect(hourShort(21)).toBe("9p");
    expect(cellSpoken(0, 18, true)).toBe("Monday 6 PM, free");
    expect(cellSpoken(6, 9, false)).toBe("Sunday 9 AM, not free");
    expect(hoursFreeLine(1)).toBe("1 hour free");
  });

  it("toggles a cell and a whole row", () => {
    let s = toggleSlot(new Set(), slotOf(0, 18));
    expect([...s]).toEqual([slotOf(0, 18)]);
    s = toggleRow(s, 18);
    expect(rowSlots(18).every((x) => s.has(x))).toBe(true);
    s = toggleRow(s, 18);
    expect(s.size).toBe(0);
  });

  it("paints the way the drag started", () => {
    const start = new Set([slotOf(1, 7)]);
    expect(paintSlot(start, slotOf(1, 7), true)).toBe(start);
    expect(paintSlot(start, slotOf(1, 8), true).has(slotOf(1, 8))).toBe(true);
    expect(paintSlot(start, slotOf(1, 7), false).size).toBe(0);
  });

  it("finds the cell under a finger", () => {
    const layout = { labelWidth: 46, cellWidth: 40, cellHeight: 44, gap: 2 };
    expect(cellAt(10, 10, layout)).toBeNull();
    expect(cellAt(47, 1, layout)).toEqual({ day: 0, hour: 6 });
    expect(cellAt(46 + 42 * 6 + 5, 46 * 15 + 5, layout)).toEqual({ day: 6, hour: 21 });
    expect(cellAt(46 + 42 * 7 + 5, 5, layout)).toBeNull();
    expect(cellAt(50, 46 * 16 + 1, layout)).toBeNull();
  });

  it("knows when nothing changed", () => {
    expect(sameSlots(new Set([1, 2]), [2, 1])).toBe(true);
    expect(sameSlots(new Set([1]), [1, 2])).toBe(false);
  });
});
