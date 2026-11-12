import { describe, expect, it } from "vitest";

import { color } from "@/constants/tokens";
import { paletteFor, resolveScheme } from "@/lib/theme";

describe("resolveScheme: the app follows the iPhone", () => {
  it("is Day in Light Mode and Night in Dark Mode", () => {
    expect(resolveScheme("light")).toBe("light");
    expect(resolveScheme("dark")).toBe("dark");
  });

  it("is Day before the phone reports an appearance", () => {
    expect(resolveScheme(null)).toBe("light");
    expect(resolveScheme(undefined)).toBe("light");
    expect(resolveScheme("unspecified")).toBe("light");
  });
});

describe("paletteFor", () => {
  it("gives Night colors in Dark Mode", () => {
    const night = paletteFor(resolveScheme("dark"), false);
    expect(night.scheme).toBe("dark");
    expect(night.paper).toBe(color.dark.paper);
    expect(night.ink).toBe(color.dark.ink);
    expect(night.onInk).toBe(color.dark.onInk);
  });

  it("switches muted text and hairlines to -hc with Increase Contrast", () => {
    const night = paletteFor("dark", true);
    expect(night.inkMuted).toBe(color.dark.inkMutedHc);
    expect(night.mutedForeground).toBe(color.dark.inkMutedHc);
    expect(night.hairlineStrong).toBe(color.dark.hairlineStrongHc);
    expect(night.input).toBe(color.dark.hairlineStrongHc);
  });
});
