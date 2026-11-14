import { describe, expect, it } from "vitest";

import { WHOS_IN_LIMIT, showMoreLabel, whosInShown } from "../whosIn";

const people = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("whosInShown", () => {
  it("shows everyone when 8 or fewer, with nothing more", () => {
    expect(whosInShown(people(8), false)).toEqual({ shown: people(8), more: 0 });
    expect(whosInShown([], false)).toEqual({ shown: [], more: 0 });
  });

  it("shows the first 8 and counts the rest", () => {
    const r = whosInShown(people(13), false);
    expect(r.shown).toEqual(people(WHOS_IN_LIMIT));
    expect(r.more).toBe(5);
  });

  it("shows everyone once expanded, with nothing more", () => {
    expect(whosInShown(people(13), true)).toEqual({ shown: people(13), more: 0 });
  });
});

describe("showMoreLabel", () => {
  it("says Show N more, and players to VoiceOver", () => {
    expect(showMoreLabel(5)).toEqual({ label: "Show 5 more", spoken: "Show 5 more players" });
    expect(showMoreLabel(1)).toEqual({ label: "Show 1 more", spoken: "Show 1 more player" });
  });
});
