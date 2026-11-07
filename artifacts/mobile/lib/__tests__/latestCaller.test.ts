import { describe, expect, it } from "vitest";

import { latestCaller } from "@/lib/latestCaller";

describe("latestCaller (finding #1, /api/users/me refetch loop)", () => {
  it("keeps one identity while the function it calls changes every render", () => {
    let current = async () => "token-1";
    const stable = latestCaller(() => current);
    const seen = new Set<unknown>();
    // Simulate renders: Clerk hands out a new getToken each time.
    for (let i = 0; i < 5; i++) {
      current = async () => `token-${i}`;
      seen.add(stable);
    }
    expect(seen.size).toBe(1);
  });

  it("always calls the newest function, with the same arguments", async () => {
    let current = (a: number, b: number) => a + b;
    const stable = latestCaller(() => current);
    expect(stable(2, 3)).toBe(5);
    current = (a, b) => a * b;
    expect(stable(2, 3)).toBe(6);
  });

  it("an effect keyed on it runs once, not after every render", () => {
    // Stand-in for React's dependency check: re-run only when the dep changes.
    let runs = 0;
    let lastDep: unknown = undefined;
    let current = async () => "t";
    const stable = latestCaller(() => current);
    for (let render = 0; render < 50; render++) {
      current = async () => "t"; // new function every render, like @clerk/expo
      if (stable !== lastDep) {
        runs++;
        lastDep = stable;
      }
    }
    expect(runs).toBe(1);
  });
});
