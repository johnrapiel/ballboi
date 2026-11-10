import { describe, expect, it } from "vitest";

import { shortTeamChoices } from "../doubles";
import type { ScheduleMatch } from "@workspace/api-client-react";
import { resultLine } from "../leagueSchedule";
import { resultSentence, setRows } from "../myMatches";
import { winnerMark } from "../winnerMark";

// Doubles W/O and double default (John, Nov 9).

describe("shortTeamChoices", () => {
  const m = { player1Id: 10, player2Id: 20 };

  it("offers a walkover to each team, then Double default, in the singles walkover words", () => {
    const choices = shortTeamChoices(m, { first: "You and Sam", second: "Jo and Lee", firstIsSide1: true });
    expect(choices.map((c) => c.label)).toEqual(["Walkover to you and Sam", "Walkover to Jo and Lee", "Double default"]);
    expect(choices.map((c) => c.result)).toEqual([{ walkoverWinnerId: 10 }, { walkoverWinnerId: 20 }, { doubleDefault: true }]);
    expect(choices[0].saved).toBe("W/O saved. You and Sam win by walkover.");
  });

  it("names your team by its first player when you're on the second side", () => {
    const choices = shortTeamChoices(m, { first: "You and Lee", second: "John and Sam", firstIsSide1: false });
    expect(choices[0].result).toEqual({ walkoverWinnerId: 20 });
    expect(choices[1].result).toEqual({ walkoverWinnerId: 10 });
  });
});

describe("showing a double default", () => {
  it("reads Double default on match rows", () => {
    const match = {
      matchId: 7,
      player1Id: 10,
      player1Name: "John Rapiel",
      player2Id: 20,
      player2Name: "Jo Park",
      player3Id: 30,
      player3Name: "Sam Lee",
      player4Id: 40,
      player4Name: "Lee King",
      status: "completed",
      score: "Double default",
      winnerId: null,
      voided: false,
    } as unknown as ScheduleMatch;
    expect(resultLine(match)).toBe("Double default");
  });

  it("marks no winner, with the words as the line", () => {
    const mark = winnerMark({ player1Name: "John and Sam", player2Name: "Jo and Lee", score: "Double default", winner: null });
    expect(mark).toMatchObject({ winner: null, player1: "plain", player2: "plain", line: "Double default" });
  });

  it("has no sets and its own sentence", () => {
    expect(setRows("Double default")).toEqual([]);
    expect(resultSentence({ you: "You and Sam", them: "Jo and Lee", score: "Double default", youWon: false })).toBe("Double default: You and Sam vs. Jo and Lee");
  });

  it("keeps W/O as before", () => {
    const mark = winnerMark({ player1Name: "John and Sam", player2Name: "Jo and Lee", score: "W/O", winner: 2 });
    expect(mark).toMatchObject({ winner: 2, line: "W/O", spoken: "Jo and Lee won by walkover" });
  });
});
