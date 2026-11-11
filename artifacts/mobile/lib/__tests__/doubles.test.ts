import { describe, expect, it } from "vitest";

import {
  andJoin,
  expiresLine,
  firstName,
  isDoublesMatch,
  matchupLine,
  opponentNames,
  partnerName,
  PARTNERS_HINT,
  shortName,
  sideOf,
  teamName,
  teamSpoken,
  unpairedLabel,
  versusLine,
  versusSpoken,
} from "../doubles";
import { isMine, opponentName, resultLine, scoreForPlayer, sideLabels } from "../leagueSchedule";
import { rowSpoken, rowSub } from "../upcoming";

// Doubles in the app (doubles flow review, John, Nov 9).

const m = {
  matchId: 1,
  player1Id: 1,
  player1Name: "John Rapiel",
  player3Id: 3,
  player3Name: "Sam Lee",
  player2Id: 2,
  player2Name: "Jo Park",
  player4Id: 4,
  player4Name: "Lee King",
};

describe("D8: four names on a match", () => {
  it("knows sides, partners and opponents from either seat", () => {
    expect(isDoublesMatch(m)).toBe(true);
    expect(sideOf(m, 3)).toBe(1);
    expect(sideOf(m, 4)).toBe(2);
    expect(sideOf(m, 9)).toBeNull();
    expect(partnerName(m, 1)).toBe("Sam Lee");
    expect(partnerName(m, 4)).toBe("Jo Park");
    expect(opponentNames(m, 3)).toEqual(["Jo Park", "Lee King"]);
    expect(opponentNames(m, 2)).toEqual(["John Rapiel", "Sam Lee"]);
  });

  it("writes You and Sam vs. Jo and Lee, and reads full names to VoiceOver", () => {
    expect(versusLine("Sam Lee", ["Jo Park", "Lee King"])).toBe("You and Sam vs. Jo and Lee");
    expect(versusSpoken("Sam Lee", ["Jo Park", "Lee King"])).toBe("You and Sam Lee versus Jo Park and Lee King");
    expect(versusLine(null, ["Jo Park"])).toBe("You vs. Jo Park");
    expect(matchupLine(m)).toBe("John Rapiel and Sam Lee vs. Jo Park and Lee King");
  });

  it("names teams with & on screen and 'and' for VoiceOver (D3)", () => {
    expect(teamName(["John Rapiel", "Sam Lee"])).toBe("John Rapiel & Sam Lee");
    expect(teamSpoken(["John Rapiel", "Sam Lee"])).toBe("John Rapiel and Sam Lee");
    expect(andJoin(["A", "B", "C"])).toBe("A, B and C");
  });

  it("D7: short names and a fallback first name", () => {
    expect(shortName("Sam Lee")).toBe("Sam L.");
    expect(shortName("Cher")).toBe("Cher");
    expect(firstName("")).toBe("Player");
  });
});

describe("league schedule helpers in doubles", () => {
  const scheduled = {
    ...m,
    player1Rating: null,
    player2Rating: null,
    player1HasAccount: true,
    player2HasAccount: true,
    status: "completed",
    score: "6-3, 6-4",
    winnerId: 1,
    inGrace: false,
    voided: false,
    locked: false,
    scheduledAt: null,
    location: null,
    editUntil: null,
    editedBy: null,
    correctedBy: null,
    correctedAt: null,
    scoreClearedBy: null,
  };

  it("counts all four as in the match, and each sees the score from their side (D7)", () => {
    expect(isMine(scheduled, 4)).toBe(true);
    expect(opponentName(scheduled, 3)).toBe("Jo Park and Lee King");
    expect(scoreForPlayer("6-3, 6-4", scheduled, 3)).toBe("6-3, 6-4");
    expect(scoreForPlayer("6-3, 6-4", scheduled, 4)).toBe("3-6, 4-6");
  });

  it("names the winning team", () => {
    expect(sideLabels(scheduled)).toEqual({ side1: "John Rapiel & Sam Lee", side2: "Jo Park & Lee King" });
    expect(resultLine(scheduled)).toBe("John Rapiel & Sam Lee won 6-3, 6-4");
    expect(resultLine({ ...scheduled, winnerId: 2, score: "3-6, 4-6" })).toBe("Jo Park & Lee King won 6-3, 6-4");
  });
});

describe("Home and Profile rows (D8)", () => {
  const row = {
    kind: "league" as const,
    opponentName: "Jo Park & Lee King",
    partnerName: "Sam Lee",
    opponentNames: ["Jo Park", "Lee King"],
    context: "Thursday Doubles",
    singles: false,
    openStatus: null,
    scheduledAt: null,
    playBy: "Sun, Nov 15",
    starts: null,
    location: null,
  };

  it("shows You and Sam vs. Jo and Lee, and reads names in full", () => {
    expect(rowSub(row)).toBe("You and Sam vs. Jo and Lee · Thursday Doubles");
    expect(rowSpoken(row)).toContain("You and Sam Lee versus Jo Park and Lee King");
    expect(rowSub({ ...row, partnerName: null, opponentNames: [], opponentName: "Jo Park" })).toBe("vs. Jo Park · Thursday Doubles");
  });
});

describe("partners copy", () => {
  it("explains each partner type in one line (D1) and each unpaired state in words (D2, D4, D9)", () => {
    expect(PARTNERS_HINT.fixed).toMatch(/keep that partner all season/);
    expect(PARTNERS_HINT.rotating).toMatch(/new teams by level/);
    expect(unpairedLabel("needs_partner")).toBe("Needs a partner");
    expect(unpairedLabel("looking")).toBe("Looking for a partner");
    expect(unpairedLabel("no_partner")).toBe("No partner yet");
  });

  it("says how long a request has left (48 hours)", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(expiresLine("2026-11-10T12:30:00Z", now)).toBe("Expires within the hour");
    expect(expiresLine("2026-11-10T17:00:00Z", now)).toBe("Expires in 5 hours");
    expect(expiresLine("2026-11-12T12:00:00Z", now)).toMatch(/^Expires [A-Z][a-z]{2} /);
  });
});
