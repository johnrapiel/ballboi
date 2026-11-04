import { describe, expect, it } from "vitest";

import { newAdminsPayload, skipSuccessor } from "@/lib/accountDeletion";

describe("newAdminsPayload", () => {
  it("sends each pick and leaves skipped leagues out", () => {
    expect(newAdminsPayload({ 1: 11, 2: null, 3: 31 })).toEqual([
      { leagueId: 1, playerId: 11 },
      { leagueId: 3, playerId: 31 },
    ]);
    expect(newAdminsPayload({})).toEqual([]);
  });
});

describe("skipSuccessor", () => {
  it("is the longest-standing member, listed first by the server", () => {
    const league = {
      leagueId: 1,
      name: "Tuesday Flex",
      members: [
        { playerId: 11, name: "Sam Lee", joinedAt: "2026-01-03T00:00:00Z" },
        { playerId: 12, name: "Ana Ruiz", joinedAt: "2026-02-01T00:00:00Z" },
      ],
    };
    expect(skipSuccessor(league)?.name).toBe("Sam Lee");
    expect(skipSuccessor({ ...league, members: [] })).toBeNull();
  });
});
