import { describe, expect, it } from "vitest";

import { needsMoreToFill } from "../olderPaging";

const base = { contentHeight: 200, viewportHeight: 700, hasMore: true, loading: false, failed: false };

describe("needsMoreToFill", () => {
  it("loads more when the messages don't fill the screen", () => {
    expect(needsMoreToFill(base)).toBe(true);
  });

  it("stops once the screen is full", () => {
    expect(needsMoreToFill({ ...base, contentHeight: 700 })).toBe(false);
    expect(needsMoreToFill({ ...base, contentHeight: 1500 })).toBe(false);
  });

  it("stops at the first message", () => {
    expect(needsMoreToFill({ ...base, hasMore: false })).toBe(false);
  });

  it("waits while a page loads, and after a failed page until Try again", () => {
    expect(needsMoreToFill({ ...base, loading: true })).toBe(false);
    expect(needsMoreToFill({ ...base, failed: true })).toBe(false);
  });

  it("waits until the list is measured", () => {
    expect(needsMoreToFill({ ...base, viewportHeight: 0 })).toBe(false);
  });
});
