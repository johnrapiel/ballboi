import { describe, expect, it } from "vitest";

import { canLeavePage, firstRunPages, pageLabel } from "@/lib/recording/firstRun";

describe("firstRunPages (B8)", () => {
  it("shows all three pages on the first recording", () => {
    expect(firstRunPages({ consented: false, release: { needed: true } }, false)).toEqual(["records", "choices", "setup"]);
    expect(firstRunPages({ consented: false, release: { needed: false } }, false)).toEqual(["records", "choices", "setup"]);
  });

  it("ends the first run on the setup page even if it was hidden on another account", () => {
    expect(firstRunPages({ consented: false }, true)).toEqual(["records", "choices", "setup"]);
  });

  it("shows the setup page alone on later recordings", () => {
    expect(firstRunPages({ consented: true, release: { needed: false } }, false)).toEqual(["setup"]);
  });

  it("skips everything once Don't show this again is checked", () => {
    expect(firstRunPages({ consented: true, release: { needed: false } }, true)).toEqual([]);
  });

  it("asks for a new release version again before the setup page", () => {
    expect(firstRunPages({ consented: true, release: { needed: true } }, false)).toEqual(["choices", "setup"]);
    expect(firstRunPages({ consented: true, release: { needed: true } }, true)).toEqual(["choices", "setup"]);
  });
});

describe("carousel rules", () => {
  it("reads the position", () => {
    expect(pageLabel(1, 3)).toBe("Page 2 of 3");
  });

  it("holds page 2 until the release box is checked, when it's asked for", () => {
    expect(canLeavePage("choices", true, false)).toBe(false);
    expect(canLeavePage("choices", true, true)).toBe(true);
    expect(canLeavePage("choices", false, false)).toBe(true);
    expect(canLeavePage("records", true, false)).toBe(true);
  });
});
