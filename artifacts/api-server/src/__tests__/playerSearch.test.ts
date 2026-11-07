import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";

// Player search (findings #15 and #18): one search for Quick match and New
// message. Anyone findable, people you know first, never you or anyone
// blocked either way.

let mockUserId: string | null = "me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@workspace/db", () => ({ db: {} }));

import {
  buildSearchResults,
  cleanQuery,
  likePattern,
  nameMatches,
  RESPECT_HIDDEN_PROFILE,
  STRANGER_LIMIT,
  type ConnectedCandidate,
  type SearchCandidate,
} from "../lib/playerSearch";
import type { PlayerSearchRepo } from "../lib/playerSearchRepo";
import { createPlayerSearchRouter } from "../routes/playerSearch";
import { parseQuickMatch } from "../lib/quickMatch";

const person = (clerkUserId: string, name: string, extra: Partial<SearchCandidate> = {}): SearchCandidate => ({
  clerkUserId,
  userId: Number(clerkUserId.replace(/\D/g, "") || 1),
  playerId: null,
  name,
  avatarUrl: null,
  ...extra,
});
const mate = (clerkUserId: string, name: string, extra: Partial<ConnectedCandidate> = {}): ConnectedCandidate => ({
  ...person(clerkUserId, name),
  playerId: 100,
  inYourLeagues: true,
  playedBefore: false,
  ...extra,
});

describe("cleanQuery and nameMatches", () => {
  it("tidies what was typed", () => {
    expect(cleanQuery("  Alex   Kim ")).toBe("Alex Kim");
    expect(cleanQuery(undefined)).toBe("");
    expect(cleanQuery(["a"])).toBe("");
    expect(cleanQuery("x".repeat(80))).toHaveLength(60);
  });

  it("needs every word, in any case or accent", () => {
    expect(nameMatches("Alex Kim", "al ki")).toBe(true);
    expect(nameMatches("José Diaz", "jose")).toBe(true);
    expect(nameMatches("Alex Kim", "alex z")).toBe(false);
    expect(nameMatches("Anyone", "")).toBe(true);
  });

  it("matches a typed % or _ literally in the database", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});

describe("buildSearchResults", () => {
  it("puts league mates first, then past opponents, then everyone else, each once", () => {
    const res = buildSearchResults({
      me: "me",
      query: "",
      blocked: new Set(),
      connected: [
        mate("u2", "Zoe Park"),
        mate("u3", "Ava Diaz", { inYourLeagues: false, playedBefore: true }),
        mate("u4", "Ben Ito"),
      ],
      strangers: [person("u5", "Cara Lin"), person("u2", "Zoe Park"), person("u6", "Al Moe")],
    });
    expect(res.players.map((p) => [p.name, p.inYourLeagues])).toEqual([
      ["Ben Ito", true],
      ["Zoe Park", true],
      ["Ava Diaz", false],
      ["Al Moe", false],
      ["Cara Lin", false],
    ]);
    expect(res.more).toBe(false);
  });

  it("never lists you or anyone blocked either way, even a league mate", () => {
    const res = buildSearchResults({
      me: "me",
      query: "",
      blocked: new Set(["u2", "u5"]),
      connected: [mate("u2", "Blocked Mate"), mate("me", "Me")],
      strangers: [person("u5", "Blocked Stranger"), person("me", "Me"), person("u6", "Fine")],
    });
    expect(res.players.map((p) => p.name)).toEqual(["Fine"]);
  });

  it("filters both groups by the search", () => {
    const res = buildSearchResults({
      me: "me",
      query: "ki",
      blocked: new Set(),
      connected: [mate("u2", "Alex Kim"), mate("u3", "Sam Lee")],
      strangers: [person("u4", "Kira Moss"), person("u5", "Ben Ito")],
    });
    expect(res.players.map((p) => p.name)).toEqual(["Alex Kim", "Kira Moss"]);
  });

  it("merges two league rows for one person", () => {
    const res = buildSearchResults({
      me: "me",
      query: "",
      blocked: new Set(),
      connected: [
        mate("u2", "Alex Kim", { inYourLeagues: false, playedBefore: true, playerId: null }),
        mate("u2", "Alex Kim", { playerId: 7 }),
      ],
      strangers: [],
    });
    expect(res.players).toEqual([
      { userId: 2, playerId: 7, name: "Alex Kim", avatarUrl: null, inYourLeagues: true, playedBefore: true },
    ]);
  });

  it("caps everyone else and says there's more", () => {
    const strangers = Array.from({ length: 4 }, (_, i) => person(`u${i + 10}`, `Player ${i}`));
    const res = buildSearchResults({ me: "me", query: "", blocked: new Set(), connected: [], strangers, limit: 3 });
    expect(res.players).toHaveLength(3);
    expect(res.more).toBe(true);
  });

  it("respects Discover's hidden profile now that Discover has the setting", () => {
    expect(RESPECT_HIDDEN_PROFILE).toBe(true);
  });
});

describe("GET /players/search", () => {
  const repo = {
    connected: vi.fn<PlayerSearchRepo["connected"]>(),
    findable: vi.fn<PlayerSearchRepo["findable"]>(),
    findableUser: vi.fn<PlayerSearchRepo["findableUser"]>(),
    blocked: vi.fn<PlayerSearchRepo["blocked"]>(),
  };
  const app = () => {
    const a = express();
    a.use("/api", createPlayerSearchRouter(repo));
    return supertest(a);
  };

  beforeEach(() => {
    mockUserId = "me";
    repo.connected.mockResolvedValue([mate("u2", "Alex Kim", { userId: 2, playerId: 20 })]);
    repo.findable.mockResolvedValue([person("u3", "Alexis Moe", { userId: 3 })]);
    repo.blocked.mockResolvedValue(new Set());
  });

  it("needs sign in", async () => {
    mockUserId = null;
    await app().get("/api/players/search").expect(401);
  });

  it("searches league mates and findable players with the tidied query", async () => {
    const res = await app().get("/api/players/search").query({ q: "  alex " }).expect(200);
    expect(repo.findable).toHaveBeenCalledWith("me", "alex", STRANGER_LIMIT + 1 + 1);
    expect(res.body).toEqual({
      players: [
        { userId: 2, playerId: 20, name: "Alex Kim", avatarUrl: null, inYourLeagues: true, playedBefore: false },
        { userId: 3, playerId: null, name: "Alexis Moe", avatarUrl: null, inYourLeagues: false, playedBefore: false },
      ],
      more: false,
    });
  });

  it("says so in plain words when the search fails", async () => {
    repo.findable.mockRejectedValueOnce(new Error("db down"));
    const res = await app().get("/api/players/search").expect(500);
    expect(res.body.error).toBe("Couldn't search players. Try again.");
  });
});

describe("Quick match takes a player found with search", () => {
  it("reads opponentUserId as the one opponent", () => {
    expect(parseQuickMatch({ opponentUserId: 9 })).toEqual({ ok: true, opponentUserId: 9 });
    expect(parseQuickMatch({ opponentUserId: 9, opponentName: "Sam" }).ok).toBe(false);
    expect(parseQuickMatch({ opponentUserId: 9, opponentPlayerId: 3 }).ok).toBe(false);
    expect(parseQuickMatch({ opponentUserId: "9" }).ok).toBe(false);
  });
});
