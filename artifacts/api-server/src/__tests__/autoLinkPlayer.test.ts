import { describe, it, expect, vi, beforeEach } from "vitest";

// A2: league records link to an account only by its verified primary email
// from Clerk. Never by display name or a typed-in email, never onto a record
// linked to someone else, and never onto a "Deleted player" record.

const getUser = vi.fn();
const getUserList = vi.fn();
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: (...a: unknown[]) => getUser(...a), getUserList: (...a: unknown[]) => getUserList(...a) } } }));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

type Player = { id: number; name: string; email: string | null; clerkUserId: string | null };
let players: Player[] = [];
let placeholders: number[] = [];
let profiles: string[] = [];
let lastPlayerFilter: unknown;
const selects: string[] = [];

// Reads the filter the code builds and applies it to the fake rows.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ and: parts }),
  eq: (col: { col: string }, value: unknown) => ({ eq: [col.col, value] }),
  ne: (col: { col: string }, value: unknown) => ({ ne: [col.col, value] }),
  isNull: (col: { col: string }) => ({ isNull: col.col }),
  inArray: (col: { col: string }, values: unknown[]) => ({ inArray: [col.col, values] }),
  sql: (_s: TemplateStringsArray, _col: unknown, value: string) => ({ emailIs: value }),
}));

type Filter = { and?: Filter[]; eq?: [string, unknown]; ne?: [string, unknown]; isNull?: string; emailIs?: string; inArray?: [string, unknown[]] };
function matches(p: Player, f: Filter): boolean {
  if (f.and) return f.and.every((x) => matches(p, x));
  if (f.eq) return (p as Record<string, unknown>)[f.eq[0]] === f.eq[1];
  if (f.ne) return (p as Record<string, unknown>)[f.ne[0]] !== f.ne[1];
  if (f.isNull) return (p as Record<string, unknown>)[f.isNull] == null;
  if (f.emailIs) return p.email?.trim().toLowerCase() === f.emailIs;
  return true;
}

function col(table: string, name: string) { return { table, col: name }; }
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (t: { __name: string }) => ({
        where: async (f: Filter) => {
          selects.push(t.__name);
          if (t.__name === "players") {
            lastPlayerFilter = f;
            return players.filter((p) => matches(p, f)).map((p) => ({ id: p.id }));
          }
          if (t.__name === "match_invites") {
            const ids = f.inArray![1] as number[];
            return placeholders.filter((id) => ids.includes(id)).map((id) => ({ id }));
          }
          if (t.__name === "users") return profiles.filter((id) => id === f.eq![1]).map((clerkUserId) => ({ clerkUserId }));
          return [];
        },
      }),
    }),
    update: () => ({
      set: (values: { clerkUserId: string }) => ({
        where: (f: Filter) => ({
          returning: async () => {
            const hit = players.filter((p) => matches(p, f));
            for (const p of hit) p.clerkUserId = values.clerkUserId;
            return hit.map((p) => ({ id: p.id }));
          },
        }),
      }),
    }),
  },
  playersTable: { __name: "players", id: col("players", "id"), name: col("players", "name"), email: col("players", "email"), clerkUserId: col("players", "clerkUserId") },
  usersTable: { __name: "users", clerkUserId: col("users", "clerkUserId") },
  matchInvitesTable: { __name: "match_invites", placeholderPlayerId: col("match_invites", "placeholderPlayerId") },
}));

import { autoLinkPlayer, autoLinkPlayersForUser } from "../lib/autoLinkPlayer";

function clerkUser(id: string, email: string, status = "verified") {
  return { id, primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: email, verification: { status } }] };
}

beforeEach(() => {
  players = [];
  placeholders = [];
  profiles = [];
  selects.length = 0;
  lastPlayerFilter = undefined;
  getUser.mockReset();
  getUserList.mockReset();
});

describe("autoLinkPlayersForUser (new profile)", () => {
  it("links admin-added records with the verified primary email from Clerk", async () => {
    players = [
      { id: 1, name: "Sam Lee", email: " Sam@Example.com ", clerkUserId: null },
      { id: 2, name: "Sam Lee", email: "other@example.com", clerkUserId: null },
    ];
    getUser.mockResolvedValue(clerkUser("user_sam", "sam@example.com"));
    expect(await autoLinkPlayersForUser("user_sam")).toBe(1);
    expect(players[0].clerkUserId).toBe("user_sam");
    expect(players[1].clerkUserId).toBeNull();
  });

  it("never links by display name", async () => {
    players = [{ id: 1, name: "Sam Lee", email: null, clerkUserId: null }];
    getUser.mockResolvedValue(clerkUser("user_sam", "sam@example.com"));
    expect(await autoLinkPlayersForUser("user_sam")).toBe(0);
    expect(players[0].clerkUserId).toBeNull();
  });

  it("does nothing when the primary email isn't verified", async () => {
    players = [{ id: 1, name: "Sam Lee", email: "sam@example.com", clerkUserId: null }];
    getUser.mockResolvedValue(clerkUser("user_x", "sam@example.com", "unverified"));
    expect(await autoLinkPlayersForUser("user_x")).toBe(0);
    expect(players[0].clerkUserId).toBeNull();
  });

  it("never takes a record linked to another account", async () => {
    players = [{ id: 1, name: "Sam Lee", email: "sam@example.com", clerkUserId: "user_real_sam" }];
    getUser.mockResolvedValue(clerkUser("user_sam2", "sam@example.com"));
    expect(await autoLinkPlayersForUser("user_sam2")).toBe(0);
    expect(players[0].clerkUserId).toBe("user_real_sam");
  });

  it("never takes a Deleted player record or a quick match placeholder", async () => {
    players = [
      { id: 1, name: "Deleted player", email: "sam@example.com", clerkUserId: null },
      { id: 2, name: "Sam", email: "sam@example.com", clerkUserId: null },
    ];
    placeholders = [2];
    getUser.mockResolvedValue(clerkUser("user_sam", "sam@example.com"));
    expect(await autoLinkPlayersForUser("user_sam")).toBe(0);
    expect(players.every((p) => p.clerkUserId === null)).toBe(true);
  });

  it("looks up records by email instead of scanning every user", async () => {
    getUser.mockResolvedValue(clerkUser("user_sam", "sam@example.com"));
    await autoLinkPlayersForUser("user_sam");
    expect(selects).not.toContain("users");
    expect(JSON.stringify(lastPlayerFilter)).toContain("sam@example.com");
  });
});

describe("autoLinkPlayer (admin adds a player)", () => {
  it("links to the one account whose verified primary email it is", async () => {
    players = [{ id: 7, name: "Ana", email: "ana@example.com", clerkUserId: null }];
    profiles = ["user_ana"];
    getUserList.mockResolvedValue({ data: [clerkUser("user_ana", "ana@example.com")] });
    expect(await autoLinkPlayer(players[0])).toBe("user_ana");
    expect(players[0].clerkUserId).toBe("user_ana");
  });

  it("doesn't link on an unverified or secondary address", async () => {
    players = [{ id: 7, name: "Ana", email: "ana@example.com", clerkUserId: null }];
    profiles = ["user_ana"];
    getUserList.mockResolvedValue({ data: [clerkUser("user_ana", "ana@example.com", "unverified")] });
    expect(await autoLinkPlayer(players[0])).toBeNull();
    getUserList.mockResolvedValue({ data: [clerkUser("user_ana", "ana.primary@example.com")] });
    expect(await autoLinkPlayer(players[0])).toBeNull();
    expect(players[0].clerkUserId).toBeNull();
  });

  it("doesn't link by name when there's no email", async () => {
    const p = { id: 7, name: "Ana", email: null, clerkUserId: null };
    expect(await autoLinkPlayer(p)).toBeNull();
    expect(getUserList).not.toHaveBeenCalled();
  });

  it("doesn't link to an account without a Ball Boi profile", async () => {
    players = [{ id: 7, name: "Ana", email: "ana@example.com", clerkUserId: null }];
    getUserList.mockResolvedValue({ data: [clerkUser("user_ana", "ana@example.com")] });
    expect(await autoLinkPlayer(players[0])).toBeNull();
  });
});
