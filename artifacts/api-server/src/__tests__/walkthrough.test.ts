import { describe, it, expect } from "vitest";
import { parseCommand, redact } from "../lib/walkthrough.js";

// The walkthrough helper commands (pnpm walkthrough ...), dev only.

describe("parseCommand", () => {
  it("reads seed and accounts", () => {
    expect(parseCommand(["seed"])).toEqual({ kind: "seed", me: null, counts: false });
    expect(parseCommand(["seed", "--me", "j@x.com"])).toEqual({ kind: "seed", me: "j@x.com", counts: false });
    expect(parseCommand(["seed", "--counts"])).toEqual({ kind: "seed", me: null, counts: true });
    expect(parseCommand([])).toEqual({ kind: "help" });
  });

  it("reads demo, defaulting to Test League 1", () => {
    expect(parseCommand(["demo"])).toEqual({ kind: "demo", me: null, leagueId: null, name: "Test League 1", counts: false, discover: false });
    expect(parseCommand(["demo", "--league", "7", "--me", "j@x.com"])).toEqual({ kind: "demo", me: "j@x.com", leagueId: 7, name: "Test League 1", counts: false, discover: false });
    expect(parseCommand(["demo", "--name", "Tuesday Night"])).toEqual({ kind: "demo", me: null, leagueId: null, name: "Tuesday Night", counts: false, discover: false });
    expect(parseCommand(["demo", "--counts"])).toEqual({ kind: "demo", me: null, leagueId: null, name: "Test League 1", counts: true, discover: false });
    expect(parseCommand(["demo", "--discover"])).toEqual({ kind: "demo", me: null, leagueId: null, name: "Test League 1", counts: false, discover: true });
    expect(parseCommand(["demo", "--league", "abc"])).toHaveProperty("error");
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

describe("redact (staging seed logs)", () => {
  it("hides secrets, connection strings and emails, and keeps one line", () => {
    const env = { DATABASE_URL: "postgresql://u:pw@ep-cool.neon.tech/db?sslmode=require", ADMIN_EMAIL: "owner@example.com", CLERK_SECRET_KEY: "sk_test_abc123" };
    const out = redact(`No Clerk account for owner@example.com via ${env.DATABASE_URL} with sk_test_abc123\nstack line`, env);
    expect(out).toBe("No Clerk account for [ADMIN_EMAIL] via [DATABASE_URL] with [CLERK_SECRET_KEY]");
    expect(redact("failed at postgres://x:y@host/db for someone+clerk_test@example.com", {})).toBe("failed at [url] for [email]");
    expect(redact("key sk_live_ZZZ leaked", {})).toBe("key [key] leaked");
  });
});

describe("parseCommand: doubles partners (D9)", () => {
  it("reads team-up, accept and decline", () => {
    expect(parseCommand(["as", "B", "team-up", "A", "12"])).toEqual({ kind: "team-up", as: "B", to: "A", leagueId: 12 });
    expect(parseCommand(["as", "C", "accept", "12"])).toEqual({ kind: "answer", as: "C", accept: true, leagueId: 12 });
    expect(parseCommand(["as", "C", "decline", "12"])).toEqual({ kind: "answer", as: "C", accept: false, leagueId: 12 });
    expect(parseCommand(["as", "B", "team-up", "B", "12"])).toEqual({ error: "Pick someone else to team up with." });
    expect(parseCommand(["as", "B", "team-up", "A"])).toMatchObject({ error: expect.stringMatching(/Usage/) });
  });
});
