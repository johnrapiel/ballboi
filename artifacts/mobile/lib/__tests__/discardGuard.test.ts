import { describe, expect, it } from "vitest";

import { guardOn, nextPhase, type DiscardPhase } from "@/lib/discardGuard";

describe("discard guard", () => {
  it("asks only while editing with changes", () => {
    expect(guardOn(true, "editing")).toBe(true);
    expect(guardOn(false, "editing")).toBe(false);
  });

  it("is off after Discard, so the saved back action goes through instead of asking again", () => {
    const phase = nextPhase("editing", "discard");
    expect(phase).toBe("discarding");
    expect(guardOn(true, phase)).toBe(false);
  });

  it("is off after Save, so leaving doesn't ask", () => {
    const phase = nextPhase("editing", "finish");
    expect(phase).toBe("finished");
    expect(guardOn(true, phase)).toBe(false);
  });

  it("Keep editing changes nothing: the guard stays on", () => {
    // Keep editing sends no event; the phase is still editing.
    expect(guardOn(true, "editing")).toBe(true);
  });

  it("never turns back on once leaving has started", () => {
    const leaving: DiscardPhase[] = ["discarding", "finished"];
    for (const p of leaving) {
      expect(nextPhase(p, "discard")).toBe(p);
      expect(nextPhase(p, "finish")).toBe(p);
      expect(guardOn(true, p)).toBe(false);
    }
  });
});
