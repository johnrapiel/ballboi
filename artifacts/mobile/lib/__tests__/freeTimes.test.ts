// Free times (decision 156): custom times in words, the old hour grid
// converted, the card summary, the sheet's list, matching and the editor.

import { describe, expect, it } from "vitest";

import { freeSummary, overlaps, parseCustom, rangesFromSlots, timeLabel } from "@workspace/free-times";

import {
  BLOCKS,
  applyCustom,
  blockHours,
  blockSpoken,
  customSpoken,
  dayLines,
  dayTimes,
  freeTimesLine,
  rangeText,
  removeTime,
  sameTimes,
  saveHint,
  toggleBlock,
  withFields,
  type FreeRange,
  noFreeTimesLine,
  sheetDays,
} from "../freeTimes";

const h = (n: number) => n * 60;
const [morning, afternoon, evening] = BLOCKS;
const slot = (day: number, hour: number) => day * 24 + hour;

describe("custom times in words", () => {
  it("reads the forms people type", () => {
    const six8 = { start: h(18), end: h(20) };
    for (const text of ["6-8pm", "6 to 8 PM", "18:00-20:00", "6pm-8pm", "6 - 8 p.m.", "6–8pm", "from 6 to 8pm", "6:00 PM to 8:00 PM", "6pm to 8"]) {
      expect(parseCustom(text), text).toEqual({ ranges: [six8], problems: [] });
    }
    expect(parseCustom("6-8pm, 9 to 10 PM")).toEqual({ ranges: [six8, { start: h(21), end: h(22) }], problems: [] });
    expect(parseCustom("6:30-8pm").ranges).toEqual([{ start: h(18) + 30, end: h(20) }]);
    expect(parseCustom("11-1pm").ranges).toEqual([{ start: h(11), end: h(13) }]);
    expect(parseCustom("9am-12").ranges).toEqual([{ start: h(9), end: h(12) }]);
    expect(parseCustom("10 to noon").ranges).toEqual([{ start: h(10), end: h(12) }]);
    expect(parseCustom("10pm-midnight").ranges).toEqual([{ start: h(22), end: 1440 }]);
    expect(parseCustom("06:00-08:00").ranges).toEqual([{ start: h(6), end: h(8) }]);
    expect(parseCustom("7-9am; 1-3pm and 6-8pm").ranges).toHaveLength(3);
    expect(parseCustom("  ,  ")).toEqual({ ranges: [], problems: [] });
  });

  it("names the part it couldn't read, in words", () => {
    expect(parseCustom("after work").problems).toEqual(["Couldn't read 'after work'. Try a time like 6 to 8 PM."]);
    expect(parseCustom("6-8pm, after work")).toEqual({
      ranges: [{ start: h(18), end: h(20) }],
      problems: ["Couldn't read 'after work'. Try a time like 6 to 8 PM."],
    });
    expect(parseCustom("6 to 8").problems).toEqual(["Add AM or PM to '6 to 8', like 6 to 8 PM."]);
    expect(parseCustom("6pm").problems).toEqual(["Add an end time to '6pm', like 6 to 8 PM."]);
    expect(parseCustom("10pm-1am").problems[0]).toMatch(/^'10pm-1am' runs past midnight/);
    expect(parseCustom("8pm-8pm").problems[0]).toMatch(/starts and ends at the same time/);
    expect(parseCustom("25:00-26:00").problems[0]).toMatch(/^Couldn't read/);
    expect(parseCustom("13pm-14pm").problems[0]).toMatch(/^Couldn't read/);
    expect(parseCustom("6:75-8pm").problems[0]).toMatch(/^Couldn't read/);
  });
});

describe("words for times", () => {
  it("says a time the short way", () => {
    expect(rangeText({ start: h(18), end: h(20) })).toBe("6 to 8 PM");
    expect(rangeText({ start: h(11), end: h(13) })).toBe("11 AM to 1 PM");
    expect(rangeText({ start: h(18) + 30, end: h(20) })).toBe("6:30 to 8 PM");
    expect(rangeText({ start: h(22), end: 1440 })).toBe("10 PM to 12 AM");
    expect(rangeText({ start: 0, end: h(6) })).toBe("12 to 6 AM");
    expect(blockHours(morning)).toBe("7 to 11");
    expect(blockHours(afternoon)).toBe("12 to 4");
    expect(blockHours(evening)).toBe("5 to 9");
    expect(timeLabel({ start: h(17), end: h(21) })).toBe("Evening, 5 to 9 PM");
    expect(timeLabel({ start: h(13), end: h(15) })).toBe("1 to 3 PM");
  });

  it("lists only the days they're free, for the Free times sheet", () => {
    const week: FreeRange[] = [
      { day: 5, start: h(13), end: h(15) },
      { day: 1, start: h(17), end: h(21) },
      { day: 5, start: h(7), end: h(11) },
    ];
    expect(dayLines(week)).toEqual([
      { day: 1, text: "Tue: Evening, 5 to 9 PM", spoken: "Tuesday: Evening, 5 to 9 PM" },
      { day: 5, text: "Sat: Morning, 7 to 11 AM; 1 to 3 PM", spoken: "Saturday: Morning, 7 to 11 AM; 1 to 3 PM" },
    ]);
    expect(dayLines([])).toEqual([]);
  });

  it("starts the sheet with the card's summary", () => {
    expect(freeTimesLine("Weekday evenings, weekend mornings", true)).toBe("Free weekday evenings, weekend mornings");
    expect(freeTimesLine("Tuesday and Thursday mornings", false)).toBe("Free Tuesday and Thursday mornings");
    expect(freeTimesLine("Most of the week", false)).toBe("Free most of the week");
    expect(freeTimesLine(null, true)).toBe("You haven't added free times yet.");
    expect(freeTimesLine(null, false)).toBe("No free times added yet.");
  });
});

describe("old hour grids", () => {
  it("convert exactly: a run that covers a block is that block, the rest stays custom", () => {
    const grid = [7, 8, 9, 10].map((x) => slot(1, x)).concat([18, 19].map((x) => slot(2, x)), [slot(5, 6), slot(5, 7)]);
    const times = rangesFromSlots(grid);
    expect(times).toEqual([
      { day: 1, start: h(7), end: h(11) },
      { day: 2, start: h(18), end: h(20) },
      { day: 5, start: h(6), end: h(8) },
    ]);
    expect(dayTimes(times, 1).on.morning).toBe(true);
    expect(dayTimes(times, 2)).toEqual({ on: { morning: false, afternoon: false, evening: false }, custom: [{ day: 2, start: h(18), end: h(20) }] });
  });

  it("keep the same summary and matches", () => {
    const evenings = [0, 1, 2, 3, 4].flatMap((d) => [18, 19, 20].map((x) => slot(d, x)));
    expect(freeSummary(rangesFromSlots([...evenings, slot(5, 8), slot(6, 9)]))).toBe("Weekday evenings, weekend mornings");
    expect(overlaps(rangesFromSlots(evenings), rangesFromSlots([slot(2, 19)]))).toBe(true);
    expect(overlaps(rangesFromSlots(evenings), rangesFromSlots([slot(2, 8)]))).toBe(false);
  });
});

describe("the editor", () => {
  it("turns a block on and off", () => {
    let week = toggleBlock([], 1, morning);
    expect(week).toEqual([{ day: 1, start: h(7), end: h(11) }]);
    week = toggleBlock(week, 5, morning);
    expect(dayTimes(week, 5).on).toEqual({ morning: true, afternoon: false, evening: false });
    expect(toggleBlock(week, 1, morning)).toEqual([{ day: 5, start: h(7), end: h(11) }]);
  });

  it("adds custom times as pills, and a typed block lights that pill", () => {
    const r = applyCustom([], 2, { text: "6-8pm, 9 to 10 PM", editing: null });
    expect(r.problems).toEqual([]);
    expect(dayTimes(r.ranges, 2).custom.map(rangeText)).toEqual(["6 to 8 PM", "9 to 10 PM"]);
    const block = applyCustom([], 3, { text: "7 to 11 am", editing: null });
    expect(dayTimes(block.ranges, 3)).toEqual({ on: { morning: true, afternoon: false, evening: false }, custom: [] });
  });

  it("keeps everything typed and changes nothing when part can't be read", () => {
    const start = toggleBlock([], 1, morning);
    const r = applyCustom(start, 2, { text: "6-8pm, after work", editing: null });
    expect(r.ranges).toEqual(start);
    expect(r.problems).toEqual(["Couldn't read 'after work'. Try a time like 6 to 8 PM."]);
  });

  it("edits and removes a custom time", () => {
    const six8: FreeRange = { day: 2, start: h(18), end: h(20) };
    const edited = applyCustom([six8], 2, { text: "6:30 to 8 PM", editing: six8 });
    expect(edited.ranges).toEqual([{ day: 2, start: h(18) + 30, end: h(20) }]);
    expect(removeTime([six8, { day: 2, start: h(21), end: h(22) }], six8)).toEqual([{ day: 2, start: h(21), end: h(22) }]);
  });

  it("counts open fields in what Save sends, and keeps Save off with a problem", () => {
    const base = toggleBlock([], 1, morning);
    const ok = withFields(base, { 2: { text: "6-8pm", editing: null } });
    expect(ok.problems).toEqual({});
    expect(ok.ranges).toHaveLength(2);
    const bad = withFields(base, { 2: { text: "after work", editing: null }, 0: { text: "", editing: null } });
    expect(bad.problems).toEqual({ 2: ["Couldn't read 'after work'. Try a time like 6 to 8 PM."] });
    expect(saveHint(bad.problems, true)).toBe("Fix the times on Wednesday first");
    expect(saveHint({}, false)).toBe("Pick or change a time first");
    expect(saveHint({}, true)).toBeUndefined();
  });

  it("knows when nothing changed, whatever the order", () => {
    const a: FreeRange[] = [{ day: 2, start: h(18), end: h(20) }, { day: 1, start: h(7), end: h(11) }];
    expect(sameTimes(a, [...a].reverse())).toBe(true);
    expect(sameTimes(a, a.slice(1))).toBe(false);
  });

  it("names each pill for VoiceOver with its day", () => {
    expect(blockSpoken(morning, 1)).toBe("Morning, 7 to 11 AM, Tuesday");
    expect(customSpoken({ day: 2, start: h(18), end: h(20) })).toBe("6 to 8 PM, Wednesday");
  });
});

describe("the Free times sheet, layout A (findings 13 and 17, John, Nov 11)", () => {
  const h = (n: number) => n * 60;

  it("lists only free days, Monday first, short day and each time on its own line", () => {
    const days = sheetDays([
      { day: 5, start: h(13), end: h(15) },
      { day: 1, start: h(17), end: h(21) },
    ]);
    expect(days.map((d) => d.short)).toEqual(["Tue", "Sat"]);
    expect(days[0].times).toEqual(["5 to 9 PM"]);
    expect(days[1].times).toEqual(["1 to 3 PM"]);
  });

  it("merges overlapping times: Sat 7 to 11 AM and 10 AM to 12 PM read 7 AM to 12 PM", () => {
    const [sat] = sheetDays([
      { day: 5, start: h(10), end: h(12) },
      { day: 5, start: h(7), end: h(11) },
    ]);
    expect(sat.times).toEqual(["7 AM to 12 PM"]);
  });

  it("merges touching times and keeps separate ones apart, sorted by start", () => {
    const [mon] = sheetDays([
      { day: 0, start: h(17), end: h(21) },
      { day: 0, start: h(12), end: h(16) },
      { day: 0, start: h(7), end: h(11) },
      { day: 0, start: h(11), end: h(12) },
    ]);
    expect(mon.times).toEqual(["7 AM to 4 PM", "5 to 9 PM"]);
    expect(mon.spoken).toBe("Monday, 7 AM to 4 PM and 5 to 9 PM");
  });

  it("never says Morning, Afternoon or Evening", () => {
    const days = sheetDays(BLOCKS.map((b) => ({ day: 2, start: b.start, end: b.end })));
    expect(days[0].times).toEqual(["7 to 11 AM", "12 to 4 PM", "5 to 9 PM"]);
    expect(days[0].spoken).not.toMatch(/Morning|Afternoon|Evening/);
  });

  it("is empty with nothing free", () => {
    expect(sheetDays([])).toEqual([]);
  });

  it("says when someone hasn't added any, by first name", () => {
    expect(noFreeTimesLine("Ross Barker", false)).toBe("Ross hasn't added free times yet.");
    expect(noFreeTimesLine("John Rapiel", true)).toBe("You haven't added free times yet.");
  });
});
