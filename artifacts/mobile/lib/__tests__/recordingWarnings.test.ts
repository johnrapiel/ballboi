import { describe, expect, it } from "vitest";

import { batteryTooLow, batteryWarning, WARN_BATTERY_PERCENT } from "@/lib/recording/limits";

describe("low battery warning while recording (G1)", () => {
  it("warns under 20% unplugged, before the 10% auto-stop", () => {
    expect(WARN_BATTERY_PERCENT).toBe(20);
    expect(batteryWarning(0.19, false)).toBe(true);
    expect(batteryWarning(0.2, false)).toBe(false);
    // Warned before it stops.
    expect(batteryWarning(0.12, false) && !batteryTooLow(0.12, false)).toBe(true);
  });

  it("never warns when plugged in or when the level is unknown", () => {
    expect(batteryWarning(0.05, true)).toBe(false);
    expect(batteryWarning(-1, false)).toBe(false);
  });
});
