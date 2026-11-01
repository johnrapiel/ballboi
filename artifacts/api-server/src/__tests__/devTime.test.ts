import { describe, it, expect } from "vitest";
import { daysBetween, devToolsAllowed, earlierTime, planShift, targetRound } from "../lib/devTime.js";

// Dev-only time controls: they move a league's dates earlier, which is the
// same as time passing for that league.

const rounds = [
  { roundNumber: 1, startDate: "2026-11-05", endDate: "2026-11-11", published: true },
  { roundNumber: 2, startDate: "2026-11-12", endDate: "2026-11-18", published: true },
  { roundNumber: 3, startDate: "2026-11-19", endDate: "2026-11-25", published: false },
];

describe("devToolsAllowed", () => {
  it("is off in production and on a live Clerk instance", () => {
    expect(devToolsAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(devToolsAllowed({ NODE_ENV: "development", CLERK_SECRET_KEY: "sk_live_x" })).toBe(false);
    expect(devToolsAllowed({ NODE_ENV: "development", CLERK_SECRET_KEY: "sk_test_x" })).toBe(true);
    expect(devToolsAllowed({})).toBe(true);
  });
});

describe("planShift", () => {
  it("starts the season today", () => {
    expect(planShift("season_started", { today: "2026-11-01", startDate: "2026-11-05", rounds: [] })).toMatchObject({ days: 4 });
    expect(planShift("season_started", { today: "2026-11-05", startDate: "2026-11-05", rounds: [] })).toHaveProperty("error");
  });

  it("acts on the latest round that's out and has started", () => {
    expect(targetRound(rounds, "2026-11-13")?.roundNumber).toBe(2);
    expect(targetRound(rounds, "2026-11-01")?.roundNumber).toBe(1);
    expect(targetRound([], "2026-11-01")).toBeNull();
  });

  it("puts the deadline yesterday, day 4 of grace, or past the grace week", () => {
    const today = "2026-11-13";
    expect(planShift("deadline_passed", { today, startDate: "2026-11-05", rounds })).toMatchObject({ days: 6 }); // Nov 18 -> Nov 12
    expect(planShift("in_grace", { today, startDate: "2026-11-05", rounds })).toMatchObject({ days: 9 }); // -> Nov 9
    expect(planShift("grace_over", { today, startDate: "2026-11-05", rounds })).toMatchObject({ days: 13 }); // -> Nov 5
  });

  it("never moves backward, and explains why", () => {
    const r = planShift("deadline_passed", { today: "2026-11-14", startDate: "2026-11-05", rounds: rounds.slice(0, 1) });
    expect(r).toHaveProperty("error");
    if ("error" in r) expect(r.error).toMatch(/already in its grace week/);
  });

  it("needs a round that's out first", () => {
    const r = planShift("deadline_passed", { today: "2026-11-05", startDate: "2026-11-05", rounds: [] });
    expect(r).toHaveProperty("error");
    if ("error" in r) expect(r.error).toMatch(/Run Flex pairing/);
  });
});

describe("date helpers", () => {
  it("counts days and moves timestamps", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(earlierTime("2026-11-10T22:00:00.000Z", 7)).toBe("2026-11-03T22:00:00.000Z");
    expect(earlierTime(null, 7)).toBeNull();
  });
});
