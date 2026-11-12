import { describe, expect, it } from "vitest";

import { routeForPushLink } from "@/lib/notificationAccess";
import {
  ADD_HOME_COURT,
  ADD_PLAYS,
  bottomRow,
  cardPrompts,
  cardSpoken,
  headToHeadLine,
  levelPill,
  levelRow,
  otherUpcomingItem,
  playsPill,
  recordedLine,
  recordedThisSeason,
  resultMeta,
  seasonCells,
  seasonSpoken,
  tabFromParam,
  townLine,
} from "@/lib/playerCard";
import { signOutConfirm } from "@/lib/signOutWarning";
import { rowSub, rowWhen } from "@/lib/upcoming";

// Profile is your player card (decisions 138 to 140, John, Nov 8).

const card = { name: "John Rapiel", rating: 3.5, plays: "singles" as const, town: "Wappingers Falls", distance: null, homeCourt: "Beacon Courts", you: true };
const season = { name: "Fall 2026", from: "2026-09-01", to: "2026-12-31", wins: 4, losses: 2, played: 6, streak: { won: true, count: 2 }, noShows: 0 };

describe("prompts in place (John, Nov 9)", () => {
  const bare = { you: true, homeCourt: null, plays: null, freeTimes: [] as { day: number; start: number; end: number }[] };

  it("asks for a home court and how you play on your own card when they're unset", () => {
    expect(cardPrompts(bare)).toEqual({ homeCourt: true, plays: true });
    expect(ADD_HOME_COURT).toBe("Add home court");
    expect(ADD_PLAYS).toBe("Add how you play");
  });

  it("stops asking once each is set", () => {
    expect(cardPrompts({ ...bare, homeCourt: "Beacon Courts" })).toEqual({ homeCourt: false, plays: true });
    expect(cardPrompts({ ...bare, plays: "both" })).toEqual({ homeCourt: true, plays: false });
    expect(cardPrompts({ ...bare, homeCourt: "Beacon Courts", plays: "singles" })).toEqual({ homeCourt: false, plays: false });
  });

  it("never prompts on someone else's card", () => {
    expect(cardPrompts({ ...bare, you: false })).toEqual({ homeCourt: false, plays: false });
  });

  it("splits your bottom row: court or Add home court on the left, Free times on the right", () => {
    expect(bottomRow(bare)).toEqual({ left: "prompt", free: true, align: "split" });
    expect(bottomRow({ ...bare, homeCourt: "Beacon Courts" })).toEqual({ left: "court", free: true, align: "split" });
  });

  it("shows Free times on every card, even with none added, left-aligned alone with no home court (finding 13)", () => {
    expect(bottomRow({ ...bare, you: false })).toEqual({ left: null, free: true, align: "start" });
    expect(bottomRow({ ...bare, you: false, homeCourt: "Beacon Courts" })).toEqual({ left: "court", free: true, align: "split" });
  });
});

describe("the card", () => {
  it("reads Level 3.5 with no Self-rated, and the Plays pill in words", () => {
    expect(levelPill(3.5)).toBe("Level 3.5");
    expect(levelPill(null)).toBeNull();
    expect(playsPill("singles")).toBe("Singles");
    expect(playsPill("both")).toBe("Singles and doubles");
    expect(playsPill(null)).toBeNull();
  });

  it("keeps Self-rated on Edit profile's Level row", () => {
    expect(levelRow(3.5, "self")).toBe("3.5 · Self-rated");
    expect(levelRow(4, "verified")).toBe("4.0 · Verified");
    expect(levelRow(null, null)).toBe("Not set");
  });

  it("is one VoiceOver element, worded like the brief", () => {
    expect(cardSpoken(card)).toBe("Your player card. John Rapiel, level 3.5, singles, Wappingers Falls. Home court Beacon Courts.");
    expect(cardSpoken({ ...card, you: false, homeCourt: null, distance: "~4 mi away", plays: null })).toBe(
      "Player card. John Rapiel, level 3.5, Wappingers Falls, about 4 miles away.",
    );
  });

  it("puts the distance beside the town on someone else's card", () => {
    expect(townLine({ town: "Fishkill", distance: "~4 mi away" })).toBe("Fishkill · ~4 mi away");
    expect(townLine({ town: null, distance: null })).toBeNull();
  });
});

describe("this season", () => {
  it("shows Record, Played, Streak and No-shows", () => {
    expect(seasonCells(season)).toEqual([
      { label: "Record", value: "4–2" },
      { label: "Played", value: "6" },
      { label: "Streak", value: "W2" },
      { label: "No-shows", value: "0" },
    ]);
    expect(seasonCells({ ...season, streak: null })[2].value).toBe("–");
  });

  it("reads as one group", () => {
    expect(seasonSpoken(season)).toBe("This season: record 4 and 2, played 6, won the last 2, no no-shows");
    expect(seasonSpoken({ ...season, streak: { won: false, count: 1 }, noShows: 1 })).toBe(
      "This season: record 4 and 2, played 6, lost the last match, 1 no-show",
    );
  });
});

describe("Ball Boi this season", () => {
  it("counts recordings inside the season on the phone's day", () => {
    const local = (m: number, d: number) => new Date(2026, m - 1, d, 18).toISOString();
    const recs = [{ recordedAt: local(8, 31) }, { recordedAt: local(9, 1) }, { recordedAt: local(11, 7) }, { recordedAt: "nope" }];
    expect(recordedThisSeason(recs, season)).toHaveLength(2);
    expect(recordedLine(1)).toBe("1 match recorded");
    expect(recordedLine(3)).toBe("3 matches recorded");
  });
});

describe("My matches moved to Profile", () => {
  it("opens the tab a link asks for", () => {
    expect(tabFromParam("results")).toBe("results");
    expect(tabFromParam("upcoming")).toBe("upcoming");
    expect(tabFromParam(undefined)).toBeNull();
    expect(tabFromParam(["results"])).toBeNull();
  });

  it("still opens a /matches push, which lands on Profile", () => {
    expect(routeForPushLink("/matches")).toBe("/matches");
  });
});

describe("Sign out in Settings", () => {
  it("always asks, and warns about recordings first", () => {
    expect(signOutConfirm(0)).toEqual({ title: "Sign out?", message: "You can sign back in any time.", confirmLabel: "Sign out" });
    expect(signOutConfirm(2).confirmLabel).toBe("Sign out anyway");
  });
});

describe("other players' cards (decision 143)", () => {
  it("reads head-to-head from your side, in full for VoiceOver", () => {
    expect(headToHeadLine("Priya Shah", { you: 2, them: 1 })).toEqual({
      text: "You and Priya: 2-1",
      spoken: "You and Priya have played 3 times. You won 2, Priya won 1.",
    });
    expect(headToHeadLine("Priya Shah", { you: 0, them: 1 }).spoken).toBe("You and Priya have played 1 time. You won 0, Priya won 1.");
  });

  it("reads their upcoming rows like yours", () => {
    const m = otherUpcomingItem({
      key: "m-3",
      kind: "league",
      matchId: 3,
      scheduledAt: null,
      playBy: "2026-11-15",
      opponentName: "Theo Brandt",
      opponentUserId: 23,
      context: "Tuesday Flex 3.5",
      location: null,
      mine: false,
    });
    expect(rowWhen(m)).toBe("Play by Sun, Nov 15");
    expect(rowSub(m)).toBe("vs. Theo Brandt · Tuesday Flex 3.5");
  });

  it("puts the league and day under a result", () => {
    expect(resultMeta({ context: "Quick match", completedAt: new Date(2026, 10, 3, 18).toISOString() })).toBe("Quick match · Nov 3");
    expect(resultMeta({ context: "League", completedAt: null })).toBe("League");
  });
});
