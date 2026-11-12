import { describe, expect, it } from "vitest";

import { MIN_TAP, slopFor, tapSlop, textTapSlop } from "../tapTarget";

describe("slopFor", () => {
  it("adds half the shortfall on each side, rounded up", () => {
    // A 22pt line needs 11pt above and below to reach 44pt.
    expect(slopFor(22)).toBe(11);
    expect(22 + 2 * slopFor(22)).toBe(MIN_TAP);
    // An odd shortfall rounds up so the target is never under 44pt.
    expect(21 + 2 * slopFor(21)).toBeGreaterThanOrEqual(MIN_TAP);
  });

  it("adds nothing once the content is already 44pt or more", () => {
    expect(slopFor(44)).toBe(0);
    expect(slopFor(60)).toBe(0);
  });

  it("falls back to a full 44pt target for a bad size", () => {
    expect(slopFor(Number.NaN)).toBe(22);
    expect(slopFor(-5)).toBe(22);
  });
});

describe("tapSlop", () => {
  it("uses the height for every side when the width isn't known", () => {
    expect(tapSlop(20)).toEqual({ top: 12, bottom: 12, left: 12, right: 12 });
  });

  it("uses the width for left and right when it is known", () => {
    expect(tapSlop(20, 120)).toEqual({ top: 12, bottom: 12, left: 0, right: 0 });
  });
});

describe("textTapSlop", () => {
  it("makes a one-line body link a 44pt target", () => {
    const slop = textTapSlop("body");
    // body is a 24pt line: 10pt above and below.
    expect(slop.top).toBe(10);
    expect(24 + slop.top + slop.bottom).toBe(MIN_TAP);
  });
});
