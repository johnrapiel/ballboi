import { describe, expect, it } from "vitest";

import { keyboardCover } from "@/lib/keyboardCover";

describe("keyboardCover", () => {
  it("is the keyboard's height when it rises from the bottom", () => {
    // iPhone 16 Pro: 874pt window, 336pt keyboard.
    expect(keyboardCover(874, 874 - 336)).toBe(336);
  });

  it("is 0 when the keyboard is down or off screen", () => {
    expect(keyboardCover(874, null)).toBe(0);
    expect(keyboardCover(874, undefined)).toBe(0);
    expect(keyboardCover(874, 874)).toBe(0);
    expect(keyboardCover(874, 1200)).toBe(0);
  });

  it("never covers more than the window", () => {
    expect(keyboardCover(874, -50)).toBe(874);
  });

  it("ignores bad numbers", () => {
    expect(keyboardCover(874, Number.NaN)).toBe(0);
    expect(keyboardCover(0, 400)).toBe(0);
  });

  it("rounds to whole points", () => {
    expect(keyboardCover(874, 537.6)).toBe(336);
  });
});
