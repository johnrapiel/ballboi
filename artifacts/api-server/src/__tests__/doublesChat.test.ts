import { describe, it, expect, vi } from "vitest";

// D6: one chat for all four, titled for each player: partner first, then the other team.

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { chatMembers } from "../services/doublesChat";
import { chatTitleFor } from "../lib/doublesTeams";

describe("chatMembers", () => {
  const accounts = new Map([
    [1, { clerkUserId: "john", name: "John Rapiel" }],
    [3, { clerkUserId: "sam", name: "Sam Lee" }],
    [2, { clerkUserId: "jo", name: "Jo Park" }],
    [4, { clerkUserId: null, name: "Lee King" }],
  ]);

  it("adds every player with an account, each with partner first then the other team", () => {
    const { members, titles } = chatMembers({ player1Id: 1, player3Id: 3, player2Id: 2, player4Id: 4 }, accounts);
    expect(members).toEqual(["john", "sam", "jo"]);
    const title = (id: string) => chatTitleFor(titles[id].split("\u0000"), 3);
    expect(title("john")).toBe("You, Sam, Jo and Lee · Week 3");
    expect(title("jo")).toBe("You, Lee, John and Sam · Week 3");
  });
});
