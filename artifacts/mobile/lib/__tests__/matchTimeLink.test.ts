import { describe, expect, it } from "vitest";

import { matchTimeLinkLabel, matchTimeLinkSpoken } from "@/lib/matchTimeLink";

describe("Match time link (finding 25)", () => {
  it("asks to set a time when none is set", () => {
    expect(matchTimeLinkLabel(false)).toBe("Set a match time");
    expect(matchTimeLinkSpoken(false, "Marcus Hall")).toBe("Set a match time for your match with Marcus Hall");
  });
  it("offers to change it once one is set", () => {
    expect(matchTimeLinkLabel(true)).toBe("Change time");
    expect(matchTimeLinkSpoken(true, "Marcus Hall")).toBe("Change the time of your match with Marcus Hall");
  });
});
