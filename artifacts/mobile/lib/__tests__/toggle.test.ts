import { describe, expect, it } from "vitest";

import { paletteFor } from "@/lib/theme";
import { KNOB_SIZE, KNOB_TRAVEL, TOGGLE_HEIGHT, TOGGLE_WIDTH, toggleLook, toggleValue } from "@/lib/toggle";

function lum(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const looks = [
  ["Day", paletteFor("light", false)],
  ["Night", paletteFor("dark", false)],
  ["Day, Increase Contrast", paletteFor("light", true)],
  ["Night, Increase Contrast", paletteFor("dark", true)],
] as const;

describe("the switch (Nov 9)", () => {
  it.each(looks)("%s: on and off look different, by the knob's fill as well as its side", (_, c) => {
    const on = toggleLook(c, true);
    const off = toggleLook(c, false);
    expect(on.knob).not.toBe(off.knob);
    expect(on.track).not.toBe(off.track);
  });

  it.each(looks)("%s: the knob stands out on the track and the card (3:1 or better)", (_, c) => {
    const on = toggleLook(c, true);
    const off = toggleLook(c, false);
    expect(ratio(on.knob, on.track)).toBeGreaterThanOrEqual(3);
    expect(ratio(on.track, c.linen)).toBeGreaterThanOrEqual(3);
    expect(ratio(on.track, c.paper)).toBeGreaterThanOrEqual(3);
    expect(ratio(off.knob, c.linen)).toBeGreaterThanOrEqual(3);
    expect(ratio(off.knob, c.paper)).toBeGreaterThanOrEqual(3);
  });

  it("night is never an ivory track with a white knob", () => {
    const on = toggleLook(paletteFor("dark", false), true);
    expect(on.knob.toUpperCase()).not.toBe("#FFFFFF");
  });

  it("Increase Contrast uses the stronger border", () => {
    expect(toggleLook(paletteFor("light", true), false).border).toBe(paletteFor("light", true).hairlineStrong);
    expect(toggleLook(paletteFor("light", true), false).border).not.toBe(toggleLook(paletteFor("light", false), false).border);
  });

  it("keeps the iOS switch's size, and the knob travels the track", () => {
    expect([TOGGLE_WIDTH, TOGGLE_HEIGHT]).toEqual([51, 31]);
    expect(KNOB_SIZE).toBeGreaterThan(20);
    expect(KNOB_TRAVEL).toBeGreaterThan(15);
  });

  it("tells VoiceOver On or Off", () => {
    expect(toggleValue(true)).toBe("On");
    expect(toggleValue(false)).toBe("Off");
  });
});
