import { describe, expect, it } from "vitest";

import type { LeagueSchedule, ScheduleMatch, ScheduleRound } from "@workspace/api-client-react";

import {
  aboutRows,
  byeLine,
  currentRound,
  earlierHeading,
  formatLine,
  isAccessibilityTextSize,
  LEAGUE_TABS,
  lastPlayoffMatch,
  lastRegularMatch,
  matchSections,
  nextRoundStart,
  notStartedText,
  seasonLine,
  seasonWeek,
  standingsSummary,
  tiebreakLine,
  whereLine,
} from "../leaguePage";
import { myWeek } from "../leagueSchedule";

// The tabbed league page (Wave 3, decision 210, John's L1 to L10, Nov 14).

const match = (id: number, p1: number, p2: number, extra: Partial<ScheduleMatch> = {}): ScheduleMatch => ({
  matchId: id,
  player1Id: p1,
  player1Name: `P${p1}`,
  player2Id: p2,
  player2Name: `P${p2}`,
  player1Rating: null,
  player2Rating: null,
  player1HasAccount: true,
  player2HasAccount: true,
  status: "scheduled",
  score: null,
  winnerId: null,
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
  ...extra,
});

const round = (n: number, phase: ScheduleRound["phase"], matches: ScheduleMatch[], byes: number[] = []): ScheduleRound => ({
  roundId: 100 + n,
  roundNumber: n,
  startDate: `2026-11-${String(2 + (n - 1) * 7).padStart(2, "0")}`,
  deadline: `2026-11-${String(8 + (n - 1) * 7).padStart(2, "0")}`,
  graceEnd: `2026-11-${String(15 + (n - 1) * 7).padStart(2, "0")}`,
  phase,
  matches,
  byes: byes.map((id) => ({ playerId: id, playerName: `P${id}`, setByAdmin: false })),
  unpaired: [],
});

const schedule = (rounds: ScheduleRound[], upcoming: LeagueSchedule["upcoming"] = []): LeagueSchedule => ({
  leagueId: 1,
  today: "2026-11-14",
  timeZone: "America/New_York",
  weeklyRounds: true,
  isAdmin: false,
  rounds,
  upcoming,
});

describe("tabs", () => {
  it("are Matches, Standings, Overview, in that order", () => {
    expect(LEAGUE_TABS.map((t) => t.label)).toEqual(["Matches", "Standings", "Overview"]);
    expect(LEAGUE_TABS[0].value).toBe("matches");
  });

  it("knows the accessibility text sizes", () => {
    expect(isAccessibilityTextSize(1)).toBe(false);
    expect(isAccessibilityTextSize(1.353)).toBe(false); // xxxLarge
    expect(isAccessibilityTextSize(1.647)).toBe(true); // AX1
    expect(isAccessibilityTextSize(3.1)).toBe(true);
    expect(isAccessibilityTextSize(Number.NaN)).toBe(false);
  });
});

describe("About this league", () => {
  const league = {
    format: "flex" as const,
    leagueType: "doubles",
    partnerMode: "fixed" as const,
    location: "Robinson Lane courts",
    area: { town: "Wappingers Falls", state: "NY", zip: "12590", lat: 0, lng: 0 },
    startDate: "2026-10-28",
    endDate: "2026-12-22",
    seasonWeeks: 8,
    playerCount: 9,
    matchDay: 2,
    matchTime: "19:00",
    timeZone: "",
    status: "active" as const,
    endedAt: null,
  };

  it("names the format with the partner mode", () => {
    expect(formatLine(league)).toBe("Flex doubles, fixed partners");
    expect(formatLine({ ...league, partnerMode: "rotating" as const })).toBe("Flex doubles, rotating partners");
    expect(formatLine({ ...league, leagueType: "singles", format: "round_robin" as const })).toBe("Round robin singles");
  });

  it("puts the courts before the area", () => {
    expect(whereLine(league)).toBe("Robinson Lane courts, Wappingers Falls, NY");
    expect(whereLine({ location: "  ", area: null })).toBeNull();
  });

  it("counts the week of the season", () => {
    expect(seasonWeek("2026-10-28", "2026-10-27", 8)).toBeNull();
    expect(seasonWeek("2026-10-28", "2026-10-28", 8)).toBe(1);
    expect(seasonWeek("2026-10-28", "2026-11-11", 8)).toBe(3);
    expect(seasonWeek("2026-10-28", "2027-02-01", 8)).toBe(8);
  });

  it("shows the dates and the week while it runs, dates alone otherwise", () => {
    expect(seasonLine(league, "2026-11-11")).toBe("Oct 28 to Dec 22 · Week 3 of 8");
    expect(seasonLine(league, "2026-10-01")).toBe("Oct 28 to Dec 22");
    expect(seasonLine({ ...league, status: "completed" as const }, "2026-11-11")).toBe("Oct 28 to Dec 22");
  });

  it("lists the rows in order and leaves out what isn't set", () => {
    expect(aboutRows(league, "2026-11-11")).toEqual([
      { label: "Format", value: "Flex doubles, fixed partners" },
      { label: "Matches", value: "Tuesdays at 7 PM" },
      { label: "Where", value: "Robinson Lane courts, Wappingers Falls, NY" },
      { label: "Season", value: "Oct 28 to Dec 22 · Week 3 of 8" },
      { label: "Players", value: "9" },
    ]);
    const bare = aboutRows({ ...league, matchDay: null, matchTime: null, location: null, area: null }, "2026-11-11");
    expect(bare.map((r) => r.label)).toEqual(["Format", "Season", "Players"]);
  });
});

describe("standings summary", () => {
  const singles = [
    { playerId: 1, playerName: "Ana Diaz", rank: 1, wins: 5, losses: 1, teamId: null, teamPlayerIds: null },
    { playerId: 2, playerName: "Sam Lee", rank: 2, wins: 4, losses: 2, teamId: null, teamPlayerIds: null },
    { playerId: 3, playerName: "Jo Park", rank: 3, wins: 4, losses: 2, teamId: null, teamPlayerIds: null },
  ];

  it("reads you, place and record, and how far behind", () => {
    const s = standingsSummary({ standings: singles, myPlayerId: 3, fixedPartners: false, partnerName: null, noPartner: false, started: true });
    expect(s).toEqual({ eyebrow: "You", title: "3rd · 4–2", line: "1 win behind Ana Diaz", spoken: "You, 3rd, 4 wins 2 losses, 1 win behind Ana Diaz" });
  });

  it("has no behind line in first place, and says 1st place when it's shared", () => {
    expect(standingsSummary({ standings: singles, myPlayerId: 1, fixedPartners: false, partnerName: null, noPartner: false, started: true })?.line).toBeNull();
    const tied = [{ ...singles[0], wins: 6 }, { ...singles[1], wins: 6, rank: 1 }, singles[2]];
    expect(standingsSummary({ standings: tied, myPlayerId: 3, fixedPartners: false, partnerName: null, noPartner: false, started: true })?.line).toBe(
      "2 wins behind 1st place",
    );
  });

  it("fixed partners: your team, with your partner", () => {
    const teams = [
      { playerId: 10, playerName: "Priya Shah & Ben Cole", rank: 1, wins: 3, losses: 0, teamId: 1, teamPlayerIds: [10, 11] },
      { playerId: 20, playerName: "You Me & Maya Chen", rank: 2, wins: 2, losses: 1, teamId: 2, teamPlayerIds: [20, 21] },
    ];
    const s = standingsSummary({ standings: teams, myPlayerId: 21, fixedPartners: true, partnerName: "Maya Chen", noPartner: false, started: true });
    expect(s?.eyebrow).toBe("Your team");
    expect(s?.title).toBe("2nd · 2–1");
    expect(s?.line).toBe("With Maya Chen · 1 win behind Priya Shah & Ben Cole");
    expect(s?.spoken).toBe("Your team, 2nd, 2 wins 1 loss, with Maya Chen, 1 win behind Priya Shah and Ben Cole");
  });

  it("fixed partners with no partner yet: no place, no button", () => {
    expect(standingsSummary({ standings: [], myPlayerId: 5, fixedPartners: true, partnerName: null, noPartner: true, started: true })).toEqual({
      eyebrow: "You",
      title: "No partner yet",
      line: null,
      spoken: "You, no partner yet",
    });
  });

  it("before the start, dashes", () => {
    const s = standingsSummary({ standings: singles, myPlayerId: 2, fixedPartners: false, partnerName: null, noPartner: false, started: false });
    expect(s?.title).toBe("– · –");
    expect(s?.spoken).toBe("You, not ranked yet");
  });

  it("nothing for someone who isn't in the standings", () => {
    expect(standingsSummary({ standings: singles, myPlayerId: 99, fixedPartners: false, partnerName: null, noPartner: false, started: true })).toBeNull();
  });

  it("tiebreak line", () => {
    expect(tiebreakLine(false, "Top 4 make the playoffs.")).toBe("Ranked by wins, then head to head. Top 4 make the playoffs.");
    expect(tiebreakLine(true, null)).toBe("Teams ranked by wins, then head to head.");
  });
});

describe("Matches sections", () => {
  const r1 = round(1, "closed", [match(1, 7, 8, { status: "completed", score: "6-1, 6-1", winnerId: 7 }), match(2, 9, 10)]);
  const r2 = round(2, "open", [match(3, 7, 9), match(4, 8, 10)]);
  const s = schedule([r2, r1, round(3, "draft", [])], [{ roundNumber: 3, startDate: "2026-11-16", deadline: "2026-11-22", graceEnd: "2026-11-29" }]);

  it("this round is the one your match is in; others leave yours out; earlier newest first", () => {
    const week = myWeek(s, 7);
    const cur = currentRound(s, week);
    expect(cur?.roundNumber).toBe(2);
    const sec = matchSections(s, cur, 7);
    expect(sec.others?.matches.map((m) => m.matchId)).toEqual([4]);
    expect(sec.earlier.map((r) => r.roundNumber)).toEqual([1]);
    expect(sec.next).toEqual([]);
  });

  it("keeps showing this round's result once it's played", () => {
    const played = schedule([round(2, "open", [match(3, 7, 9, { status: "completed", score: "6-3, 6-4", winnerId: 7 })]), r1]);
    expect(myWeek(played, 7)?.match?.matchId).toBe(3);
  });

  it("drops Other matches this round when only yours is in it", () => {
    const alone = schedule([round(2, "open", [match(3, 7, 9)])]);
    expect(matchSections(alone, currentRound(alone, myWeek(alone, 7)), 7).others).toBeNull();
  });

  it("a bye: the round after it goes out on its start date", () => {
    const bye = schedule([round(2, "open", [match(4, 8, 10)], [7])], [{ roundNumber: 3, startDate: "2026-11-16", deadline: "2026-11-22", graceEnd: "2026-11-29" }]);
    const week = myWeek(bye, 7);
    expect(week?.bye).toBe(true);
    expect(byeLine(nextRoundStart(bye, week!.round))).toBe("Your next round goes out Mon, Nov 16");
    // Your bye leaves the round's other matches.
    expect(matchSections(bye, week!.round, 7).others?.byes).toEqual([]);
    expect(byeLine(null)).toBeNull();
  });

  it("finds your last regular-season match", () => {
    expect(lastRegularMatch(s, 8)?.match?.matchId).toBe(4);
    expect(lastRegularMatch(s, 99)).toBeNull();
  });

  it("names earlier rounds Regular season during playoffs", () => {
    expect(earlierHeading(false)).toBe("Earlier rounds");
    expect(earlierHeading(true)).toBe("Regular season");
  });

  it("before the start: the start date and when the first match shows", () => {
    expect(notStartedText("2026-11-20")).toEqual({ title: "Starts Fri, Nov 20", message: "Your first match shows here when round 1 goes out." });
    expect(notStartedText(null).title).toBe("Not started yet");
  });
});

describe("playoffs", () => {
  const seed = (id: number, n: number) => ({ playerId: id, playerName: `P${id}`, seed: n });
  const bracket = {
    rounds: [
      {
        round: "semifinal" as const,
        playBy: null,
        pastPlayBy: false,
        slots: [
          { round: "semifinal" as const, slot: 0, matchId: 50, player1: seed(1, 1), player2: seed(4, 4), status: "completed", score: "6-2, 6-2", winnerId: 1 },
          { round: "semifinal" as const, slot: 1, matchId: 51, player1: seed(2, 2), player2: seed(3, 3), status: "completed", score: "6-4, 6-4", winnerId: 2 },
        ],
      },
      {
        round: "final" as const,
        playBy: null,
        pastPlayBy: false,
        slots: [{ round: "final" as const, slot: 0, matchId: 52, player1: seed(1, 1), player2: seed(2, 2), status: "scheduled", score: null, winnerId: null }],
      },
    ],
  };

  it("knocked out: your last playoff match is the one you lost", () => {
    expect(lastPlayoffMatch(bracket, 4)?.slot.matchId).toBe(50);
    expect(lastPlayoffMatch(bracket, 3)?.round.round).toBe("semifinal");
  });

  it("not in the bracket: nothing", () => {
    expect(lastPlayoffMatch(bracket, 9)).toBeNull();
    expect(lastPlayoffMatch(null, 1)).toBeNull();
  });
});
