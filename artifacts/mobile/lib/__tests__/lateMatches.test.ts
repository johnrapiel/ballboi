import { describe, expect, it } from "vitest";

import type { LeagueWeekItem } from "@workspace/api-client-react";

import { LATE_NOTE, LATE_RESULT, LATE_ROUND_RESULT, lateDateLine, lateTime, phaseLabel, roundPlayByLine } from "@/lib/leagueSchedule";
import { cardWhen, rowSpoken, rowWhen, upcomingList } from "@/lib/upcoming";

// Late matches (decision 152, John, Nov 8): a league match past its week shows
// "Play by" the end of its extra week, never its old date as if upcoming, and
// one plain sentence about standings. No "grace week", no "Ball Boi stats".

// Local times, so the labels read the same in any time zone the tests run in.
const now = new Date(2026, 10, 8, 12, 0); // Sun, Nov 8, noon
const local = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const lateItem = (o: Partial<LeagueWeekItem>): LeagueWeekItem => ({
  leagueId: 1,
  leagueName: "Test League 1",
  roundId: 10,
  roundNumber: 2,
  phase: "grace",
  startDate: "2026-10-31",
  deadline: "2026-11-06",
  graceEnd: "2026-11-13",
  bye: false,
  matchId: 100,
  myPlayerId: 1,
  opponentName: "Mike Okafor",
  opponentPlayerId: 7,
  singles: true,
  scheduledAt: null,
  location: null,
  played: false,
  timeZone: zone,
  ...o,
});

describe("the late match note", () => {
  it("is one plain sentence", () => {
    expect(LATE_NOTE).toBe("This match's week has passed. You can still play it, but the result won't change the standings.");
  });

  it("uses the short labels on result rows and round cards", () => {
    expect(LATE_RESULT).toBe("Not in standings");
    expect(LATE_ROUND_RESULT).toBe("Late: not in standings");
    expect(phaseLabel("grace")).toBe("Late matches");
  });

  it("never says grace week, Ball Boi stats, or uses an em dash", () => {
    const all = [LATE_NOTE, LATE_RESULT, LATE_ROUND_RESULT, phaseLabel("grace"), roundPlayByLine({ phase: "open", deadline: "2026-11-06", graceEnd: "2026-11-13" }, zone)!, roundPlayByLine({ phase: "grace", deadline: "2026-11-06", graceEnd: "2026-11-13" }, zone)!];
    for (const s of all) {
      expect(s).not.toMatch(/grace/i);
      expect(s).not.toMatch(/Ball Boi stats/);
      expect(s).not.toContain("—");
    }
  });
});

describe("a late match's date line", () => {
  it("reads Play by the end of the extra week when no time is set", () => {
    expect(lateDateLine(null, "2026-11-13", zone, now)).toBe("Play by Fri, Nov 13");
  });

  it("keeps a saved time that's still ahead", () => {
    expect(lateTime(local(10, 18, 30), now)).toBe(local(10, 18, 30));
    expect(lateDateLine(local(10, 18, 30), "2026-11-13", zone, now)).toBe("Tue, Nov 10 at 6:30 PM");
  });

  it("drops a saved time that has passed and reads Play by instead", () => {
    expect(lateTime(local(6, 18, 30), now)).toBeNull();
    expect(lateDateLine(local(6, 18, 30), "2026-11-13", zone, now)).toBe("Play by Fri, Nov 13");
  });
});

describe("a late match on Home", () => {
  const list = (scheduledAt: string | null) => upcomingList({ week: { thisWeek: [lateItem({ scheduledAt })], playoffs: [] }, now });

  it("with no time: Late match, Play by the end of the extra week", () => {
    const [m] = list(null);
    expect(m.grace).toBe(true);
    expect(cardWhen(m, now)).toEqual({ dateLabel: "Late match", time: "Play by Fri, Nov 13" });
    expect(rowWhen(m, now)).toBe("Play by Fri, Nov 13");
    expect(rowSpoken(m, now)).toMatch(/^Late match, play by Fri, Nov 13\. Versus Mike Okafor/);
  });

  it("with a time still ahead: keeps that time", () => {
    const [m] = list(local(10, 18, 30));
    expect(cardWhen(m, now)).toEqual({ dateLabel: "Tuesday, Nov 10", time: "6:30 PM" });
    expect(rowWhen(m, now)).toBe("Tue, Nov 10 · 6:30 PM");
  });

  it("with a time that has passed: Play by, never the old date as upcoming", () => {
    const [m] = list(local(6, 18, 30));
    expect(m.scheduledAt).toBeNull();
    expect(cardWhen(m, now)).toEqual({ dateLabel: "Late match", time: "Play by Fri, Nov 13" });
    expect(rowWhen(m, now)).toBe("Play by Fri, Nov 13");
  });
});

describe("a round card's line", () => {
  const round = { deadline: "2026-11-06", graceEnd: "2026-11-13" };

  it("before the deadline: Play by, then how long late matches have", () => {
    expect(roundPlayByLine({ ...round, phase: "open" }, zone)).toBe("Play by Fri, Nov 6. Late matches can be played until Fri, Nov 13.");
  });

  it("after the deadline: how long late matches have, and that they don't change standings", () => {
    expect(roundPlayByLine({ ...round, phase: "grace" }, zone)).toBe("Late matches can be played until Fri, Nov 13. Their results don't change the standings.");
  });

  it("nothing once the round is closed or the league has ended", () => {
    expect(roundPlayByLine({ ...round, phase: "closed" }, zone)).toBeNull();
    expect(roundPlayByLine({ ...round, phase: "grace" }, zone, true)).toBeNull();
  });
});
