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

describe("micState", async () => {
  const { micState } = await import("@/lib/recording/permissions");
  it("says when only the microphone is denied", () => {
    expect(micState({ granted: false, status: "denied", canAskAgain: false })).toBe("denied");
    expect(micState({ granted: false, status: "denied", canAskAgain: true })).toBe("denied");
  });
  it("asks while iOS can still prompt", () => {
    expect(micState({ granted: false, status: "undetermined", canAskAgain: true })).toBe("ask");
  });
  it("is fine when allowed or still loading", () => {
    expect(micState({ granted: true, status: "granted", canAskAgain: true })).toBe("ok");
    expect(micState(null)).toBe("ok");
  });
});

describe("audio copy (T2, T6)", () => {
  it("says audio is held during the beta, and deleted after analysis after launch", async () => {
    const { audioCopy } = await import("@/lib/recording/firstRun");
    expect(audioCopy(true).carousel).toContain("During the beta, we keep it for up to 30 days");
    expect(audioCopy(true).carousel).toContain("until Ball Boi launches");
    expect(audioCopy(true).cameraAccess).not.toMatch(/deleted after analysis/);
    expect(audioCopy(false).carousel).toContain("deleted after your match is analyzed");
    expect(audioCopy(false).cameraAccess).toContain("deleted after analysis");
  });
});
