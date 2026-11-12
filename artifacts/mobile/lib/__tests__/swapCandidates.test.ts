import { describe, expect, it } from "vitest";

import { levelNumber, swapCandidates } from "@/lib/swapCandidates";

const people = [
  { playerId: 1, name: "Maya Chen" },
  { playerId: 2, name: "Elena Ortiz" },
  { playerId: 3, name: "Sam Patel" },
  { playerId: 4, name: "Ana Reyes" },
  { playerId: 5, name: "Ben Lowe" },
  { playerId: 6, name: "Una Placeholder" },
];
const levels: Record<number, string | undefined> = { 1: "3.5", 2: "3.5", 3: "4.5", 4: "3.0", 5: "4.0" };
const levelOf = (id: number) => levels[id];

describe("swapCandidates", () => {
  it("leaves out the player and their current opponent", () => {
    const ids = swapCandidates(people, people[0], 2, levelOf).map((p) => p.playerId);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
  });

  it("puts the closest level first, ties by name, no level last", () => {
    const names = swapCandidates(people, people[0], 2, levelOf).map((p) => p.name);
    expect(names).toEqual(["Ana Reyes", "Ben Lowe", "Sam Patel", "Una Placeholder"]);
  });

  it("sorts by name when the player has no level", () => {
    const names = swapCandidates(people, people[5], null, levelOf).map((p) => p.name);
    expect(names).toEqual(["Ana Reyes", "Ben Lowe", "Elena Ortiz", "Maya Chen", "Sam Patel"]);
  });

  it("lists someone once even if they appear twice", () => {
    const list = swapCandidates([...people, people[3]], people[0], null, levelOf);
    expect(list.filter((p) => p.playerId === 4)).toHaveLength(1);
  });
});

describe("levelNumber", () => {
  it("reads a level string", () => {
    expect(levelNumber("3.5")).toBe(3.5);
    expect(levelNumber("")).toBeNull();
    expect(levelNumber(null)).toBeNull();
  });
});
