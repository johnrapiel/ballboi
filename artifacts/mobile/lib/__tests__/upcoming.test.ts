import { describe, expect, it } from "vitest";

import type { LeagueWeekItem, LeagueWeekPlayoff } from "@workspace/api-client-react";

import { cardWhen, isMatchDay, rowSpoken, rowSub, rowWhen, upcomingList } from "@/lib/upcoming";

// Home shows only upcoming matches (decision 137, John, Nov 8): one list,
// league, playoff and Discover, in date order, with the canvas's row text.

// Local times, so the labels read the same in any time zone the tests run in.
const now = new Date(2026, 10, 10, 8, 0); // Tue, Nov 10, 8:00 AM
const local = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();

const item = (o: Partial<LeagueWeekItem>): LeagueWeekItem => ({
  leagueId: 1,
  leagueName: "Tuesday Flex 3.5",
  roundId: 10,
  roundNumber: 3,
  phase: "open",
  startDate: "2026-11-09",
  deadline: "2026-11-15",
  graceEnd: "2026-11-22",
  bye: false,
  matchId: 100,
  myPlayerId: 1,
  opponentName: "Mike Okafor",
  opponentPlayerId: 7,
  singles: true,
  scheduledAt: null,
  location: null,
  played: false,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...o,
});

const playoff = (o: Partial<LeagueWeekPlayoff>): LeagueWeekPlayoff =>
  ({
    leagueId: 1,
    leagueName: "Tuesday Flex 3.5",
    matchId: 300,
    round: "semifinal",
    opponentName: "Theo Brandt",
    opponentPlayerId: 9,
    singles: true,
    scheduledAt: null,
    location: null,
    playBy: "2026-11-20",
    pastPlayBy: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...o,
  }) as LeagueWeekPlayoff;

describe("the upcoming list", () => {
  const list = upcomingList({
    week: {
      thisWeek: [
        item({ matchId: 100 }),
        item({ matchId: 101, opponentName: "Sam Patel", scheduledAt: local(10, 18, 30), location: "Beacon Courts · Court 3" }),
        item({ matchId: 102, played: true }),
        item({ matchId: null, bye: true, roundId: 11 }),
      ],
      playoffs: [playoff({}), playoff({ matchId: 301, pastPlayBy: true })],
    },
    plans: [
      { id: 5, startsAt: local(14, 9), courtName: "Fishkill Rec Park", kind: "singles", matchId: 200, score: null, otherName: "Priya Shah", otherUserId: 42 },
      { id: 6, startsAt: local(12, 9), courtName: null, kind: "singles", matchId: 201, score: "6-4, 6-4", otherName: "Ray Alvarez", otherUserId: 43 },
    ],
    open: [
      { id: 8, startsAt: local(13, 17), format: "doubles", courtName: "Beacon Courts", status: "open", spotsLeft: 2 },
      { id: 9, startsAt: local(13, 18), format: "doubles", courtName: null, status: "canceled", spotsLeft: 0 },
    ],
    stage: (r) => (r === "semifinal" ? "Semifinal" : "Playoffs"),
  });

  it("holds every match still to play, in date order", () => {
    expect(list.map((m) => m.key)).toEqual(["m-101", "open-8", "plan-5", "m-100", "po-300"]);
  });

  it("leaves out byes, played matches, scored Discover matches, past playoffs and cancelled posts", () => {
    const keys = list.map((m) => m.key);
    for (const k of ["m-102", "plan-6", "po-301", "open-9"]) expect(keys).not.toContain(k);
  });

  it("reads like the canvas rows", () => {
    const [today, open, discover, noTime, semi] = list;
    expect(rowWhen(today, now)).toBe("Today · 6:30 PM");
    expect(rowSub(today)).toBe("vs. Sam Patel · Tuesday Flex 3.5");
    expect(rowWhen(discover, now)).toBe("Sat, Nov 14 · 9:00 AM");
    expect(rowSub(discover)).toBe("vs. Priya Shah · Discover");
    expect(rowWhen(noTime, now)).toBe("Play by Sun, Nov 15");
    expect(rowSub(noTime)).toBe("vs. Mike Okafor · Tuesday Flex 3.5");
    expect(rowSub(semi)).toBe("vs. Theo Brandt · Tuesday Flex 3.5 · Semifinal");
    expect(rowSub(open)).toBe("Open match · Doubles · 2 spots left");
  });

  it("reads each row in full for VoiceOver", () => {
    const [today, , discover, noTime] = list;
    expect(rowSpoken(today, now)).toBe("Today, 6:30 PM. Versus Sam Patel at Beacon Courts · Court 3. Tuesday Flex 3.5");
    expect(rowSpoken(discover, now)).toBe("Saturday, November 14, 9 AM. Versus Priya Shah at Fishkill Rec Park. Set up in Discover");
    expect(rowSpoken(noTime, now)).toBe("No time set yet, play by Sun, Nov 15. Versus Mike Okafor. Tuesday Flex 3.5");
  });

  it("names a round that hasn't started by its start day", () => {
    const [m] = upcomingList({ week: { thisWeek: [item({ phase: "upcoming", startDate: "2026-11-16" })], playoffs: [] } });
    expect(rowWhen(m, now)).toBe("Starts Mon, Nov 16");
    expect(m.notStarted).toBe(true);
  });
});

describe("the D2 card", () => {
  it("leads with Record only on match day: a set time today", () => {
    expect(isMatchDay({ scheduledAt: local(10, 18, 30) }, now)).toBe(true);
    expect(isMatchDay({ scheduledAt: local(14, 9) }, now)).toBe(false);
    expect(isMatchDay({ scheduledAt: null }, now)).toBe(false);
  });

  it("shows the date and the big time, or the play-by date", () => {
    expect(cardWhen({ scheduledAt: local(10, 18, 30), playBy: null, starts: null }, now)).toEqual({ dateLabel: "Today", time: "6:30 PM" });
    expect(cardWhen({ scheduledAt: null, playBy: "Sun, Nov 15", starts: null }, now)).toEqual({ dateLabel: "No time set yet", time: "By Sun, Nov 15" });
  });
});
