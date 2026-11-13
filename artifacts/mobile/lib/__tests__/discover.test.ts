import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  activeFilters,
  filteredEmptyBody,
  filtersButtonLabel,
  areaLine,
  clampRadius,
  countLine,
  filtersSpoken,
  levelChip,
  levelsText,
  pickedLevels,
  toggleLevel,
  initials,
  inviteMessage,
  isCustomRadius,
  levelRangeText,
  picksFromPlays,
  playersPath,
  playsFromPicks,
  radiusChipSpoken,
  rowDetail,
} from "../discover";

describe("Discover header and chips", () => {
  it("names your area and the count", () => {
    expect(areaLine({ zip: "12590", town: "Wappingers Falls", state: "NY" })).toBe("Near 12590, Wappingers Falls");
    expect(countLine(14, 10)).toBe("14 players within 10 mi");
    expect(countLine(1, 5)).toBe("1 player within 5 mi");
    expect(countLine(3, 10, "open match")).toBe("3 open matches within 10 mi");
  });

  it("reads a count chip the way the brief says (finding 5)", () => {
    expect(radiusChipSpoken(10, 14, true)).toBe("10 miles, 14 players, selected");
    expect(radiusChipSpoken(1, 1, false)).toBe("1 mile, 1 player");
    expect(radiusChipSpoken(5, null, false)).toBe("5 miles");
  });

  it("keeps a custom distance to whole miles from 1 to 30", () => {
    expect(clampRadius(0)).toBe(1);
    expect(clampRadius(42)).toBe(30);
    expect(clampRadius(12.4)).toBe(12);
    expect(isCustomRadius(12)).toBe(true);
    expect(isCustomRadius(15)).toBe(false);
  });

  it("asks for players with the filters", () => {
    expect(playersPath(10, DEFAULT_FILTERS)).toBe("/api/discover/players?radius=10&levels=mine&plays=either");
    expect(playersPath(99, { levels: [], plays: "doubles", free: true })).toBe(
      "/api/discover/players?radius=30&levels=&plays=doubles&free=1",
    );
    expect(playersPath(10, { levels: [3, 3.5], plays: "either", free: false })).toBe(
      "/api/discover/players?radius=10&levels=3.0,3.5&plays=either",
    );
  });

  it("spells out the level range", () => {
    expect(levelRangeText(3.5, "close")).toBe("Level 3.0 to 4.0. You're 3.5.");
    expect(levelRangeText(3.5, "wider")).toBe("Level 2.5 to 4.5. You're 3.5.");
    expect(levelRangeText(null, "close")).toMatch(/Add your level/);
  });

  it("reads the Filters button", () => {
    expect(filtersSpoken(DEFAULT_FILTERS, 10)).toBe("distance 10 miles, your level, plays either, free when I'm free off");
    expect(filtersSpoken({ levels: [3.5, 4], plays: "singles", free: true }, 15)).toBe(
      "distance 15 miles, level 3.5, 4.0, plays singles, free when I'm free on",
    );
  });

  it("lists every level with yours selected by default (John, Nov 7)", () => {
    expect(pickedLevels("mine", 3.5)).toEqual([3.5]);
    expect(pickedLevels("mine", 3.4)).toEqual([3.5]);
    expect(pickedLevels("mine", null)).toEqual([]);
    expect(toggleLevel("mine", 3.5, 4)).toEqual([3.5, 4]);
    expect(toggleLevel("mine", 3.5, 3.5)).toEqual([]);
    expect(toggleLevel([4, 3.5], 3.5, 3)).toEqual([3, 3.5, 4]);
    expect(levelsText("mine", 3.5)).toBe("Showing 3.5, your level.");
    expect(levelsText([3, 3.5, 4], 3.5)).toBe("Showing 3.0, 3.5 and 4.0.");
    expect(levelsText([], 3.5)).toBe("Showing every level.");
    expect(levelsText("mine", null)).toBe("Showing every level. Add your level in Profile.");
    expect(levelChip(6)).toBe(5);
  });

  it("fills the invite message", () => {
    expect(inviteMessage("12590")).toBe(
      "Play tennis with me on Ball Boi. I'm finding matches near 12590. Join me so we can play: https://ballboi.tennis",
    );
  });
});

describe("rows and the player card", () => {
  it("shows distance and plays, never free times (F14)", () => {
    expect(rowDetail({ distance: "~4 mi", plays: "singles" })).toBe("~4 mi · Singles");
    expect(rowDetail({ distance: "~2 mi", plays: "both" })).toBe("~2 mi · Singles and doubles");
    expect(rowDetail({ distance: "~7 mi", plays: null })).toBe("~7 mi");
  });

  it("maps the I play chips", () => {
    expect(playsFromPicks(true, true)).toBe("both");
    expect(playsFromPicks(false, false)).toBeNull();
    expect(picksFromPlays("doubles")).toEqual({ singles: false, doubles: true });
  });

  it("makes initials", () => {
    expect(initials("Sam Whitfield")).toBe("SW");
    expect(initials("Cher")).toBe("C");
  });
});

import { leagueStanding, leagueTagLabel, seasonLine, spotsLine } from "../discover";

describe("Open leagues", () => {
  const base = { member: false, myRequest: null, joining: "request" as const };

  it("knows where you stand", () => {
    expect(leagueStanding(base)).toBe("request");
    expect(leagueStanding({ ...base, joining: "waitlist" })).toBe("waitlist");
    expect(leagueStanding({ ...base, myRequest: { kind: "request", status: "pending" } })).toBe("requested");
    expect(leagueStanding({ ...base, myRequest: { kind: "waitlist", status: "pending" } })).toBe("waitlisted");
    expect(leagueStanding({ ...base, myRequest: { kind: "request", status: "declined" } })).toBe("declined");
    expect(leagueStanding({ ...base, member: true })).toBe("member");
  });

  it("writes the season and spots lines", () => {
    expect(seasonLine({ startLabel: "Sun, Nov 22", seasonWeeks: 8, started: false })).toBe("Starts Sun, Nov 22 · 8 weeks");
    expect(seasonLine({ startLabel: "Sun, Nov 1", seasonWeeks: null, started: true })).toBe("Started Sun, Nov 1");
    expect(spotsLine({ rosterCap: 16, spotsTaken: 13, spotsLeft: 3 })).toBe("13 of 16 taken · 3 left");
    expect(spotsLine({ rosterCap: null, spotsTaken: 4, spotsLeft: null })).toBeNull();
  });

  it("names every tag in words", () => {
    expect(leagueTagLabel("outside_level")).toBe("Outside your level");
    expect(leagueTagLabel("full")).toBe("Full");
    expect(leagueTagLabel("started")).toBe("Season started");
  });
});

import { courtLine, courtSpoken, courtsPath } from "../discover";

describe("court directory", () => {
  const court = { courtId: 1, name: "Beacon Courts", address: "Memorial Park, Beacon NY 12508", distance: "~3 mi" };
  it("writes the row and reads it out", () => {
    expect(courtLine(court)).toBe("Beacon Courts · ~3 mi");
    expect(courtLine({ ...court, distance: null })).toBe("Beacon Courts");
    expect(courtSpoken(court, true)).toBe("Beacon Courts, about 3 miles away, Memorial Park, Beacon NY 12508, selected");
  });
  it("searches", () => {
    expect(courtsPath("")).toBe("/api/courts");
    expect(courtsPath("  beacon  park ")).toBe("/api/courts?q=beacon%20park");
  });
});

import { actionLabel, defaultPlanStart, eventCopy, planDetail, type MatchPlan, type PlanEvent } from "../discover";

describe("match cards in chat", () => {
  const plan: MatchPlan = {
    id: 1,
    startsAt: "2026-11-12T23:00:00.000Z",
    timeZone: "America/New_York",
    courtName: "Fishkill Rec Park",
    kind: "singles",
    matchId: 9,
    score: null,
    mine: false,
    events: [],
  };
  const ev = (e: Partial<PlanEvent>): PlanEvent => ({
    key: "k",
    type: "proposed",
    at: "2026-11-10T12:00:00Z",
    by: "them",
    actions: [],
    ...e,
  });

  it("asks the other player and tells the sender they're waiting", () => {
    expect(eventCopy(ev({ state: "waiting" }), plan, "Sam Whitfield").title).toBe("Add this match?");
    expect(eventCopy(ev({ state: "waiting", by: "me" }), plan, "Sam Whitfield").body).toMatch(/Waiting for Sam\.$/);
    expect(eventCopy(ev({ state: "replaced" }), plan, "Sam").title).toBe("Replaced by a newer time");
  });

  it("says the dispute line exactly (F12)", () => {
    expect(eventCopy(ev({ type: "no_show_disputed" }), plan, "Sam").title).toBe(
      "You two remember this differently, so we've left it off both cards.",
    );
  });

  it("labels the answers", () => {
    expect(actionLabel("accept", "Sam")).toBe("I'm in");
    expect(actionLabel("decline", "Sam")).toBe("Can't make it");
    expect(actionLabel("dispute", "Sam")).toBe("That's not right");
    expect(planDetail({ courtName: null, kind: "practice" })).toBe("Court not set · Practice hit");
  });

  it("starts a new card tomorrow at 6 PM", () => {
    const d = defaultPlanStart(new Date(2026, 10, 7, 9, 30));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([8, 18, 0]);
  });
});

import { needLabel, openMatchesPath, waitingLine, whosInLine, windowEnd } from "../discover";

describe("open matches", () => {
  it("writes the tags and lines", () => {
    expect(needLabel(2)).toBe("Need 2");
    expect(whosInLine({ total: 4, spotsLeft: 1 })).toBe("Who's in · 3 of 4");
    expect(waitingLine(2)).toBe("2 spots left. We'll open a group chat when they fill, and let you know.");
    expect(waitingLine(1)).toBe("1 spot left. We'll open a group chat when it fills, and let you know.");
    expect(openMatchesPath(12)).toBe("/api/open-matches?radius=12");
    expect(windowEnd(new Date("2026-11-14T14:00:00Z"), 2).toISOString()).toBe("2026-11-14T16:00:00.000Z");
  });
});

describe("filter-aware empty state (decision 190)", () => {
  it("counts only filters that narrow the list", () => {
    expect(activeFilters(DEFAULT_FILTERS)).toEqual([]);
    expect(activeFilters({ ...DEFAULT_FILTERS, levels: [] })).toEqual([]);
    expect(activeFilters({ ...DEFAULT_FILTERS, free: true })).toEqual(["free"]);
    expect(activeFilters({ levels: [3.5], plays: "singles", free: true })).toEqual(["free", "levels", "plays"]);
  });

  it("names the filters in plain words", () => {
    expect(filteredEmptyBody({ ...DEFAULT_FILTERS, free: true })).toBe("Nobody nearby is free when you are.");
    expect(filteredEmptyBody({ ...DEFAULT_FILTERS, plays: "singles" })).toBe("Nobody nearby plays singles.");
    expect(filteredEmptyBody({ levels: [3.0, 3.5, 4.0], plays: "doubles", free: true })).toBe(
      "Nobody nearby is free when you are, is at levels 3.0, 3.5 or 4.0 and plays doubles.",
    );
  });

  it("says how many filters are on for VoiceOver", () => {
    expect(filtersButtonLabel(DEFAULT_FILTERS, 10)).toMatch(/^Filters: distance 10 miles/);
    expect(filtersButtonLabel({ ...DEFAULT_FILTERS, free: true }, 5)).toMatch(/^Filters, 1 on: distance 5 miles/);
  });
});

import { cardActions } from "../discover";

describe("match card answers (finding 46)", () => {
  it("puts Can't make it in the corner and keeps the rest as buttons", () => {
    expect(cardActions(["cancel"])).toEqual({ cantMakeIt: "cancel", buttons: [] });
    expect(cardActions(["still_on", "cancel"])).toEqual({ cantMakeIt: "cancel", buttons: ["still_on"] });
    expect(cardActions(["accept", "decline"])).toEqual({ cantMakeIt: "decline", buttons: ["accept"] });
  });
  it("leaves cards without Can't make it alone", () => {
    expect(cardActions(["undo"])).toEqual({ cantMakeIt: null, buttons: ["undo"] });
    expect(cardActions(["score", "no_show", "not_played"])).toEqual({ cantMakeIt: null, buttons: ["score", "no_show", "not_played"] });
    expect(cardActions([])).toEqual({ cantMakeIt: null, buttons: [] });
  });
});
