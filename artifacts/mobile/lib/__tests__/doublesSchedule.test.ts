import { describe, expect, it } from "vitest";

import type { ScheduleMatch } from "@workspace/api-client-react";

import { firstNames, isMine, matchPlayers, matchTitle, opponentName, partnerOf, resultLine, scoreForPlayer, sideOf } from "@/lib/leagueSchedule";

// Wave 2: doubles in the league schedule. Side 1 is player 1 and player 3,
// side 2 is player 2 and player 4.

const doubles = {
  matchId: 1,
  player1Id: 1,
  player1Name: "Alex Kim",
  player3Id: 3,
  player3Name: "Sam Lee",
  player2Id: 2,
  player2Name: "Jo Park",
  player4Id: 4,
  player4Name: "Lee Chen",
  status: "completed",
  score: "6-3, 6-4",
  winnerId: 2,
  voided: false,
} as unknown as ScheduleMatch;

const singles = { ...doubles, player3Id: null, player3Name: null, player4Id: null, player4Name: null, winnerId: 1 } as unknown as ScheduleMatch;

describe("doubles names", () => {
  it("titles a match by its two teams", () => {
    expect(matchTitle(doubles)).toBe("Alex Kim and Sam Lee vs. Jo Park and Lee Chen");
    expect(matchTitle(singles)).toBe("Alex Kim vs. Jo Park");
  });

  it("names both opponents and your partner", () => {
    expect(opponentName(doubles, 3)).toBe("Jo Park and Lee Chen");
    expect(opponentName(doubles, 4)).toBe("Alex Kim and Sam Lee");
    expect(partnerOf(doubles, 4)).toEqual({ playerId: 2, name: "Jo Park" });
    expect(partnerOf(singles, 1)).toBeNull();
  });

  it("lists everyone in the match, side 1 first", () => {
    expect(matchPlayers(doubles).map((p) => p.playerId)).toEqual([1, 3, 2, 4]);
    expect(matchPlayers(singles).map((p) => p.playerId)).toEqual([1, 2]);
  });

  it("shortens names to first names", () => {
    expect(firstNames("Jo Park and Lee Chen")).toBe("Jo and Lee");
    expect(firstNames("Jo Park")).toBe("Jo");
  });
});

describe("doubles sides", () => {
  it("finds every player's side", () => {
    expect([1, 2, 3, 4, 5].map((id) => sideOf(doubles, id))).toEqual([1, 2, 1, 2, null]);
    expect(isMine(doubles, 4)).toBe(true);
    expect(isMine(doubles, 5)).toBe(false);
  });

  it("shows a partner's score from their side", () => {
    expect(scoreForPlayer("6-3, 6-4", doubles, 3)).toBe("6-3, 6-4");
    expect(scoreForPlayer("6-3, 6-4", doubles, 4)).toBe("3-6, 4-6");
  });

  it("names the winning team in the result", () => {
    // Stored from side 1: side 2 won 3-6, 4-6, so they read 6-3, 6-4.
    const m = { ...doubles, score: "3-6, 4-6" } as ScheduleMatch;
    expect(resultLine(m)).toBe("Jo Park and Lee Chen won 6-3, 6-4");
  });
});
