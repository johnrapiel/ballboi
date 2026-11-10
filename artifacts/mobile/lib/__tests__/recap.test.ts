import { describe, expect, it } from "vitest";

import { recapView, shortName } from "@/lib/recap";

// The match recap (decision 148): names, score and lines on the image.

const base = {
  you: 2 as const,
  side1: ["Sam Patel"],
  side2: ["John Rapiel"],
  score: "3-6, 6-7(4)",
  winner: 2 as const,
  playedAt: "2026-11-07T18:00:00Z",
  court: "Beacon Courts",
  context: "Tuesday Flex 3.5",
  season: { name: "Fall 2026", wins: 5, losses: 2 },
};

describe("recap", () => {
  it("shortens the opponent to first name and last initial", () => {
    expect(shortName("Sam Patel")).toBe("Sam P.");
    expect(shortName("Mary Jane watson")).toBe("Mary W.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("  Priya   Shah ")).toBe("Priya S.");
  });

  it("puts you in full first when you win, with the score from your side", () => {
    const v = recapView(base);
    expect(v.headline).toBe("John Rapiel def. Sam P.");
    expect(v.top).toEqual({ names: "John Rapiel", won: true });
    expect(v.bottom).toEqual({ names: "Sam P.", won: false });
    expect(v.score).toBe("6-3, 7-6(4)");
    expect(v.meta).toBe("Beacon Courts · Tuesday Flex 3.5");
    expect(v.season).toBe("5-2 this season");
    expect(v.date).toBe("Sat, Nov 7, 2026");
  });

  it("puts the opponent first when you lose", () => {
    const v = recapView({ ...base, winner: 1, score: "6-3, 6-4" });
    expect(v.headline).toBe("Sam P. def. John Rapiel");
    expect(v.top).toEqual({ names: "Sam P.", won: true });
    expect(v.score).toBe("6-3, 6-4");
  });

  it("names teams in the same pattern for doubles", () => {
    const v = recapView({ ...base, side1: ["Sam Patel", "Priya Shah"], side2: ["John Rapiel", "Alex Kim"] });
    // D7 (John, Nov 9): team names, every name short.
    expect(v.headline).toBe("John R. & Alex K. def. Sam P. & Priya S.");
  });

  it("shows Discover and Quick matches, RET and W/O", () => {
    expect(recapView({ ...base, court: null, context: "Quick match" }).meta).toBe("Quick match");
    expect(recapView({ ...base, score: "3-6, 1-2 RET" }).score).toBe("6-3, 2-1 · RET");
    expect(recapView({ ...base, score: "W/O" }).score).toBe("W/O");
  });

  it("describes the image for VoiceOver", () => {
    expect(recapView(base).description).toBe(
      "Ball Boi match recap. John Rapiel defeated Sam P., 6-3, 7-6(4). Sat, Nov 7, 2026. Beacon Courts · Tuesday Flex 3.5. 5-2 this season.",
    );
  });
});
