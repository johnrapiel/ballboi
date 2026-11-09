import { describe, expect, it } from "vitest";

import { ageOn, ageRangeOutcome, canAskAppleAgeRange, isAgeCheckPassed, neutralStartDate } from "@/lib/ageCheck";

describe("Apple's age range (acceptance 36)", () => {
  it("an adult goes straight past the birthday step", () => {
    expect(ageRangeOutcome({ lowerBound: 18, upperBound: null })).toBe("adult");
    expect(ageRangeOutcome({ lowerBound: 21, upperBound: 25 })).toBe("adult");
  });

  it("under 18 gets no account", () => {
    expect(ageRangeOutcome({ lowerBound: null, upperBound: 17 })).toBe("under18");
    expect(ageRangeOutcome({ lowerBound: 13, upperBound: 15 })).toBe("under18");
  });

  it("anything unclear asks for the birthday (acceptance 37)", () => {
    expect(ageRangeOutcome(null)).toBe("askBirthday");
    expect(ageRangeOutcome(undefined)).toBe("askBirthday");
    expect(ageRangeOutcome({ lowerBound: null, upperBound: null })).toBe("askBirthday");
    // A range that straddles 18 can't decide it.
    expect(ageRangeOutcome({ lowerBound: 16, upperBound: 20 })).toBe("askBirthday");
  });

  it("is only asked on iOS 26 or later, where Apple really answers", () => {
    expect(canAskAppleAgeRange("ios", "26.1")).toBe(true);
    expect(canAskAppleAgeRange("ios", 27)).toBe(true);
    // Earlier iOS answers "adult" for everyone, so it must never be asked.
    expect(canAskAppleAgeRange("ios", "18.6")).toBe(false);
    expect(canAskAppleAgeRange("android", 34)).toBe(false);
    expect(canAskAppleAgeRange("ios", "")).toBe(false);
  });
});

describe("the birthday step", () => {
  it("counts whole years", () => {
    expect(ageOn(new Date(2000, 5, 15), new Date(2018, 5, 14))).toBe(17);
    expect(ageOn(new Date(2000, 5, 15), new Date(2018, 5, 15))).toBe(18);
  });

  it("starts the wheels 30 years back, never at exactly 18", () => {
    expect(neutralStartDate(new Date(2026, 10, 9)).getFullYear()).toBe(1996);
  });

  it("only the pass flag counts", () => {
    expect(isAgeCheckPassed({ ageCheck: "passed" })).toBe(true);
    expect(isAgeCheckPassed({ ageCheck: "1990-01-01" })).toBe(false);
    expect(isAgeCheckPassed(null)).toBe(false);
  });
});
