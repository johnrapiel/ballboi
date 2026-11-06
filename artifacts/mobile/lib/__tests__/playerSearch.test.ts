import { describe, expect, it } from "vitest";

import {
  newMessageSections,
  noResultsMessage,
  personKey,
  quickMatchOpponent,
  relationLabel,
  searchPath,
  type PlayerSearchResult,
} from "../playerSearch";

const p = (name: string, extra: Partial<PlayerSearchResult> = {}): PlayerSearchResult => ({
  userId: 1,
  playerId: 10,
  name,
  avatarUrl: null,
  inYourLeagues: false,
  playedBefore: false,
  ...extra,
});

describe("player search helpers", () => {
  it("builds the search address, tidied and encoded", () => {
    expect(searchPath("")).toBe("/api/players/search");
    expect(searchPath("   ")).toBe("/api/players/search");
    expect(searchPath("  José  D ")).toBe("/api/players/search?q=Jos%C3%A9%20D");
  });

  it("splits New message into In your leagues, then All Ball Boi players", () => {
    const sections = newMessageSections([
      p("Alex", { inYourLeagues: true }),
      p("Ben", { playedBefore: true }),
      p("Cara"),
      // On Ball Boi but not messageable until messaging by account lands (#117).
      p("Dee", { playerId: null }),
    ]);
    expect(sections.leagues.map((x) => x.name)).toEqual(["Alex"]);
    expect(sections.everyone.map((x) => x.name)).toEqual(["Ben", "Cara"]);
  });

  it("picks a Quick match opponent by account when it can", () => {
    expect(quickMatchOpponent(p("A", { userId: 4, playerId: 9 }))).toEqual({ opponentUserId: 4 });
    expect(quickMatchOpponent(p("A", { userId: null, playerId: 9 }))).toEqual({ opponentPlayerId: 9 });
    expect(quickMatchOpponent(p("A", { userId: null, playerId: null }))).toBeNull();
  });

  it("keys each person once", () => {
    expect(personKey(p("A", { userId: 4 }))).toBe("u4");
    expect(personKey(p("A", { userId: null, playerId: 9 }))).toBe("p9");
  });

  it("says how you know someone", () => {
    expect(relationLabel(p("A", { inYourLeagues: true, playedBefore: true }))).toBe("In your leagues");
    expect(relationLabel(p("A", { playedBefore: true }))).toBe("Played before");
    expect(relationLabel(p("A"))).toBeNull();
  });

  it("nudges to Someone not on Ball Boi only in Quick match", () => {
    expect(noResultsMessage("zed", "quickMatch")).toEqual({
      title: 'No players named "zed"',
      message: "Check the spelling, or add them as someone not on Ball Boi and send them a link.",
    });
    expect(noResultsMessage("zed", "newMessage").message).not.toContain("not on Ball Boi");
  });
});
