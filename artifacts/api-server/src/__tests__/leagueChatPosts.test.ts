import { describe, it, expect } from "vitest";
import { ordinal, pairingsPost, resultPost, standingsPost, standingsSnapshot } from "../lib/leagueChatPosts";
import { findMentions } from "../messaging/mentions";

// League chat automatic posts and @mentions (decision 145): short and plain.

describe("automatic posts", () => {
  it("says when pairings go out", () => {
    expect(pairingsPost(4)).toBe("Round 4 pairings are out.");
  });

  it("states a result from the winners' side", () => {
    expect(resultPost({ winners: ["Sam Patel"], losers: ["John Rapiel"], score: "6-3, 6-4" })).toBe("Sam Patel def. John Rapiel 6-3, 6-4.");
    expect(resultPost({ winners: ["Sam Patel", "Ana Ruiz"], losers: ["John Rapiel", "Lee Chen"], score: "7-6(4), 6-2" })).toBe(
      "Sam Patel and Ana Ruiz def. John Rapiel and Lee Chen 7-6(4), 6-2.",
    );
    expect(resultPost({ winners: ["Sam Patel"], losers: ["John Rapiel"], score: "6-3, 2-1 RET" })).toBe("Sam Patel def. John Rapiel 6-3, 2-1, retired.");
    expect(resultPost({ winners: ["Sam Patel"], losers: ["John Rapiel"], score: "W/O" })).toBe("Sam Patel def. John Rapiel by walkover.");
    expect(resultPost({ winners: ["Sam Patel"], losers: ["John Rapiel"], score: "6-4, 6-4", edited: true })).toBe(
      "Score edited: Sam Patel def. John Rapiel 6-4, 6-4.",
    );
  });

  it("names who moved up in the standings, and nothing else", () => {
    const before = { "1": 1, "2": 2, "3": 3, "4": 4 };
    expect(standingsPost(before, [
      { playerId: 2, name: "Sam Patel", rank: 1 },
      { playerId: 1, name: "John Rapiel", rank: 2 },
      { playerId: 3, name: "Ana Ruiz", rank: 3 },
      { playerId: 4, name: "Lee Chen", rank: 4 },
    ])).toBe("Standings: Sam Patel moves up to 1st.");
    expect(standingsPost(before, [
      { playerId: 2, name: "Sam Patel", rank: 1 },
      { playerId: 4, name: "Lee Chen", rank: 2 },
      { playerId: 1, name: "John Rapiel", rank: 3 },
      { playerId: 3, name: "Ana Ruiz", rank: 4 },
    ])).toBe("Standings: Sam Patel moves up to 1st, Lee Chen to 2nd.");
    expect(standingsPost(before, [{ playerId: 1, name: "John Rapiel", rank: 1 }])).toBeNull();
    expect(standingsPost(null, [{ playerId: 1, name: "John Rapiel", rank: 1 }])).toBeNull();
    expect(standingsSnapshot([{ playerId: 7, name: "X", rank: 2 }])).toEqual({ "7": 2 });
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});

describe("@mentions", () => {
  const people = [
    { userId: "sam", name: "Sam Patel" },
    { userId: "samuel", name: "Sam" },
    { userId: "ana", name: "Ana Ruiz" },
  ];

  it("finds full names after @, in any case", () => {
    expect(findMentions("@Sam Patel and @ana ruiz, Thursday?", people)).toEqual(["sam", "ana"]);
  });

  it("matches the longest name, so a shorter one isn't mentioned too", () => {
    expect(findMentions("@Sam Patel hi", people)).toEqual(["sam"]);
    expect(findMentions("@Sam hi", people)).toEqual(["samuel"]);
  });

  it("needs the whole name, and ignores plain text and emails", () => {
    expect(findMentions("@Sammy and Sam Patel and sam@ex.com", people)).toEqual([]);
    expect(findMentions("@Ana Ruizz", people)).toEqual([]);
  });
});
