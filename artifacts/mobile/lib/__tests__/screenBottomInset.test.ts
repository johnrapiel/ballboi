import { describe, expect, it } from "vitest";

import { PINNED_BAR_ESTIMATE, SCREEN_GAP, UIKIT_TAB_BAR_HEIGHT, screenBottomInset } from "@/lib/screenBottomInset";

describe("screenBottomInset", () => {
  it("uses the space between cards as the one gap", () => {
    expect(SCREEN_GAP).toBe(24);
  });

  it("clears the JS tab bar by its measured height, which already includes the home indicator", () => {
    const r = screenBottomInset({ kind: "tabBar", measured: 83, safeBottom: 34, windowSafeBottom: 34 });
    expect(r).toEqual({ paddingBottom: 83 + SCREEN_GAP, indicatorBottom: 83 });
  });

  it("follows the tab bar when larger text makes it taller", () => {
    const r = screenBottomInset({ kind: "tabBar", measured: 120, safeBottom: 34, windowSafeBottom: 34 });
    expect(r.paddingBottom).toBe(120 + SCREEN_GAP);
  });

  it("uses the tab's safe area for the iOS 26 system tab bar", () => {
    const r = screenBottomInset({ kind: "tabBar", measured: undefined, safeBottom: 95, windowSafeBottom: 34 });
    expect(r).toEqual({ paddingBottom: 95 + SCREEN_GAP, indicatorBottom: 95 });
  });

  it("never lets the system tab bar cover the last card if the safe area reports only the home indicator", () => {
    const r = screenBottomInset({ kind: "tabBar", measured: undefined, safeBottom: 34, windowSafeBottom: 34 });
    expect(r.paddingBottom).toBe(34 + UIKIT_TAB_BAR_HEIGHT + SCREEN_GAP);
  });

  it("clears a pinned button bar by its measured height", () => {
    const r = screenBottomInset({ kind: "pinned", height: 107, safeBottom: 34 });
    expect(r).toEqual({ paddingBottom: 107 + SCREEN_GAP, indicatorBottom: 107 });
  });

  it("estimates a pinned bar before it has measured itself", () => {
    const r = screenBottomInset({ kind: "pinned", height: 0, safeBottom: 34 });
    expect(r.paddingBottom).toBe(34 + PINNED_BAR_ESTIMATE + SCREEN_GAP);
  });

  it("keeps just the gap above a button bar laid out below the list", () => {
    expect(screenBottomInset({ kind: "barBelow" })).toEqual({ paddingBottom: SCREEN_GAP, indicatorBottom: 0 });
  });

  it("keeps the home indicator plus the gap on screens with nothing pinned", () => {
    expect(screenBottomInset({ kind: "none", safeBottom: 34 })).toEqual({ paddingBottom: 34 + SCREEN_GAP, indicatorBottom: 34 });
    expect(screenBottomInset({ kind: "none", safeBottom: 0 }).paddingBottom).toBe(SCREEN_GAP);
  });

  it("ignores missing or broken numbers", () => {
    expect(screenBottomInset({ kind: "none", safeBottom: Number.NaN }).paddingBottom).toBe(SCREEN_GAP);
    expect(screenBottomInset({ kind: "pinned", height: -5, safeBottom: 0 }).paddingBottom).toBe(PINNED_BAR_ESTIMATE + SCREEN_GAP);
  });
});
