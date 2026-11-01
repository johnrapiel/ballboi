import { describe, it, expect } from "vitest";
import { parseCommand } from "../lib/walkthrough.js";

// The walkthrough helper commands (pnpm walkthrough ...), dev only.

describe("parseCommand", () => {
  it("reads seed and accounts", () => {
    expect(parseCommand(["seed"])).toEqual({ kind: "seed", me: null });
    expect(parseCommand(["seed", "--me", "j@x.com"])).toEqual({ kind: "seed", me: "j@x.com" });
    expect(parseCommand([])).toEqual({ kind: "help" });
  });

  it("reads acting as B, C or D", () => {
    expect(parseCommand(["as", "c", "message", "a", "Want", "to", "hit?"])).toEqual({ kind: "message", as: "C", to: "A", text: "Want to hit?" });
    expect(parseCommand(["as", "B", "join", "abc23456"])).toEqual({ kind: "join", as: "B", code: "abc23456" });
    expect(parseCommand(["as", "D", "report", "C"])).toEqual({ kind: "report", as: "D", about: "C", reason: "harassment" });
    expect(parseCommand(["as", "B", "score", "6-3,", "6-4", "--match", "12"])).toEqual({ kind: "score", as: "B", score: "6-3, 6-4", matchId: 12 });
    expect(parseCommand(["as", "B", "leave"])).toEqual({ kind: "leave", as: "B", leagueId: null });
  });

  it("refuses acting as A, messaging yourself, and unknown reasons", () => {
    expect(parseCommand(["as", "A", "message", "B", "hi"])).toHaveProperty("error");
    expect(parseCommand(["as", "C", "message", "C", "hi"])).toHaveProperty("error");
    expect(parseCommand(["as", "D", "report", "C", "rude"])).toHaveProperty("error");
  });

  it("reads time controls for the seeded league or a league id", () => {
    expect(parseCommand(["time", "grace-over"])).toEqual({ kind: "time", league: "seeded", action: "grace_over" });
    expect(parseCommand(["time", "12", "season-started"])).toEqual({ kind: "time", league: 12, action: "season_started" });
    expect(parseCommand(["time", "tomorrow"])).toHaveProperty("error");
    expect(parseCommand(["pair-now", "7"])).toEqual({ kind: "pair-now", league: 7 });
  });
});
