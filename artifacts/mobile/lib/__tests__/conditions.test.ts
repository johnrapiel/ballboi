import { describe, expect, it } from "vitest";

import { CONDITION_GROUPS, conditionsToSave, isEmpty, NO_CONDITIONS, toggleCondition } from "@/lib/recording/conditions";

describe("conditions at stop", () => {
  it("offers Indoor / Outdoor, Day / Night and the four surfaces", () => {
    expect(CONDITION_GROUPS.map((g) => g.options.map((o) => o.label))).toEqual([
      ["Indoor", "Outdoor"],
      ["Day", "Night"],
      ["Hard", "Clay", "Grass", "Other"],
    ]);
  });

  it("picks, switches and clears with a second tap", () => {
    let c = toggleCondition(NO_CONDITIONS, "setting", "outdoor");
    c = toggleCondition(c, "light", "night");
    c = toggleCondition(c, "surface", "hard");
    expect(c).toEqual({ setting: "outdoor", light: "night", surface: "hard" });
    expect(toggleCondition(c, "surface", "clay").surface).toBe("clay");
    expect(toggleCondition(c, "light", "night").light).toBeNull();
  });

  it("skipped means null", () => {
    expect(isEmpty(NO_CONDITIONS)).toBe(true);
    expect(conditionsToSave(NO_CONDITIONS)).toBeNull();
    expect(conditionsToSave({ setting: null, light: "day", surface: null })).toEqual({ setting: null, light: "day", surface: null });
  });
});
