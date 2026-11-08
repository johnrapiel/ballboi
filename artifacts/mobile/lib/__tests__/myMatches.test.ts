import { describe, expect, it } from "vitest";

import type { LeagueWeekItem, LeagueWeekPlayoff } from "@workspace/api-client-react";

import { editedLine } from "@/lib/leagueSchedule";
import {
  durationLabel,
  leagueLine,
  ordinal,
  recordLabel,
  resultSentence,
  scoreFootnote,
  seasonSpoken,
  setRows,
  streakLabel,
  upcomingMatches,
  winRateLabel,
} from "@/lib/myMatches";

// Findings 6, 7 and 14 (John, Nov 6): Home's season stats, My matches, Match detail.

describe("season stats", () => {
  const season = { wins: 4, losses: 2, played: 6, streak: { won: true, count: 2 } };
  it("reads like the approved design: 4–2, 67%, Won 2", () => {
    expect(recordLabel(season)).toBe("4–2");
    expect(winRateLabel(season)).toBe("67%");
    expect(streakLabel(season)).toBe("Won 2");
    expect(streakLabel({ streak: { won: false, count: 1 } })).toBe("Lost 1");
  });
  it("shows dashes before the first result, and says so to VoiceOver", () => {
    const none = { wins: 0, losses: 0, played: 0, streak: null };
    expect(winRateLabel(none)).toBe("–");
    expect(streakLabel(none)).toBe("–");
    expect(seasonSpoken(none)).toBe("Your season. No results yet.");
    expect(seasonSpoken(season)).toBe("Your season. Record 4 and 2. Win rate 67%. Won your last 2. 6 played.");
  });
});

const item = (over: Partial<LeagueWeekItem>): LeagueWeekItem => ({
  leagueId: 1, leagueName: "Men's 3.5", roundId: 1, roundNumber: 3, phase: "open", startDate: "2026-11-05", deadline: "2026-11-11",
  graceEnd: "2026-11-18", bye: false, matchId: 100, myPlayerId: 10, opponentName: "Mike Okafor", opponentPlayerId: 11, singles: true,
  scheduledAt: null, location: null, played: false, timeZone: "America/New_York", ...over,
});
const playoff = (over: Partial<LeagueWeekPlayoff>): LeagueWeekPlayoff => ({
  leagueId: 1, leagueName: "Men's 3.5", matchId: 200, round: "semifinal", opponentName: "Dana", opponentPlayerId: 12, singles: true,
  timeZone: "America/New_York", playBy: "2026-11-20", pastPlayBy: false, scheduledAt: null, location: null, ...over,
});

describe("upcomingMatches", () => {
  it("lists only matches still to play, soonest first, set times before play-by dates", () => {
    const out = upcomingMatches({
      thisWeek: [
        item({ matchId: 100 }),
        item({ matchId: 101, scheduledAt: "2026-11-08T22:30:00Z" }),
        item({ matchId: 102, played: true }),
        item({ matchId: null, bye: true }),
      ],
      playoffs: [playoff({}), playoff({ matchId: 201, pastPlayBy: true })],
    });
    expect(out.map((m) => m.matchId)).toEqual([101, 100, 200]);
    expect(out[2].stage).toBe("Playoffs");
  });
  it("is empty with no data", () => {
    expect(upcomingMatches(undefined)).toEqual([]);
  });
});

describe("Match detail helpers", () => {
  it("splits a score into set rows, tiebreaks kept, RET and W/O handled", () => {
    expect(setRows("6-4, 7-6(4)")).toEqual([
      { you: 6, them: 4, tiebreak: null },
      { you: 7, them: 6, tiebreak: 4 },
    ]);
    expect(setRows("6-3, 2-1 RET")).toHaveLength(2);
    expect(setRows("W/O")).toEqual([]);
  });
  it("says who beat whom from the winner's side", () => {
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "6-4, 7-5", youWon: true })).toBe("John Rapiel beat Ray Alvarez 6-4, 7-5");
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "4-6, 5-7", youWon: false })).toBe("Ray Alvarez beat John Rapiel 6-4, 7-5");
    expect(resultSentence({ you: "John Rapiel", them: "Ray Alvarez", score: "6-3, 2-1 RET", youWon: true })).toBe("John Rapiel beat Ray Alvarez 6-3, 2-1, Ray retired");
  });
  it("formats the replay length", () => {
    expect(durationLabel(5520)).toBe("1h 32m");
    expect(durationLabel(2880)).toBe("48m");
    expect(durationLabel(null)).toBeNull();
  });
  it("footnote: who entered it, then the 24 hours, then the league admin", () => {
    const base = { played: true, enteredBy: "John Rapiel", enteredAt: "2026-11-06T19:30:00Z", editUntil: null, correctedBy: null, leagueEnded: false };
    expect(scoreFootnote({ ...base, editUntil: "2026-11-07T19:30:00Z" })).toMatch(/^Entered by John Rapiel, .+\. Either player can edit it until .+\.$/);
    expect(scoreFootnote(base)).toMatch(/Your league admin can correct it in Manage\.$/);
    expect(scoreFootnote({ ...base, leagueEnded: true })).toMatch(/scores are final/);
    expect(scoreFootnote({ ...base, played: false })).toBeNull();
    expect(scoreFootnote({ ...base, enteredBy: null })).toMatch(/^Entered by your league admin\./);
  });
  it("says who edited a score, and nothing before an edit", () => {
    expect(editedLine({ editedBy: "Ray Alvarez" })).toBe("Score edited by Ray Alvarez");
    expect(editedLine({ editedBy: null })).toBeNull();
  });
});

describe("Your leagues", () => {
  it("reads place and record like the approved design", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(22)).toBe("22nd");
    expect(leagueLine({ location: "Beacon Courts", rank: 2, playerCount: 8, wins: 4, losses: 2 })).toBe("Beacon Courts · 2nd of 8 · 4–2");
    expect(leagueLine({ location: null, rank: null, playerCount: 0, wins: 0, losses: 0 })).toBe("0–0");
  });
});
