import { describe, expect, it } from "vitest";
import { areaLabel, createLeagueBlocker, prefillArea } from "../leagueArea";

// New league needs a name and an area (finding 19, decision 182).

const found = { state: "found" as const, area: { zip: "12590", town: "Wappingers Falls", state: "NY" } };

describe("prefillArea", () => {
  it("starts from your home area's town, then your ZIP, then nothing", () => {
    expect(prefillArea({ area: found.area, homeZip: "12590" })).toBe("Wappingers Falls, NY");
    expect(prefillArea({ area: null, homeZip: "12590" })).toBe("12590");
    expect(prefillArea(undefined)).toBe("");
  });
});

describe("createLeagueBlocker", () => {
  it("says what's missing, or nothing when both are filled", () => {
    expect(createLeagueBlocker("", { state: "empty" })).toBe("Add a league name and area to create it");
    expect(createLeagueBlocker("  ", found)).toBe("Add a league name to create it");
    expect(createLeagueBlocker("Tuesday 3.5", { state: "empty" })).toBe("Add the league's area to create it");
    expect(createLeagueBlocker("Tuesday 3.5", { state: "error", message: "x" })).toBe("Check the league's area to create it");
    expect(createLeagueBlocker("Tuesday 3.5", { state: "checking" })).toBe("Checking the league's area");
    expect(createLeagueBlocker("Tuesday 3.5", found)).toBeNull();
  });
});

describe("areaLabel", () => {
  it("is the town and state, or null for an old league", () => {
    expect(areaLabel(found.area)).toBe("Wappingers Falls, NY");
    expect(areaLabel(null)).toBeNull();
  });
});
