import { describe, it, expect, vi, beforeEach } from "vitest";

// Profile photos show everywhere (John, Nov 8), except across a block, either way.

const rows = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => rows() }) }) },
  usersTable: { clerkUserId: "clerk_user_id", avatarUrl: "avatar_url" },
}));
vi.mock("drizzle-orm", () => ({ inArray: () => ({}) }));
const blocked = vi.fn(async () => new Set<string>());
vi.mock("../lib/blocks.js", () => ({ blockedAccountsFor: () => blocked() }));

const { visiblePhotos } = await import("../lib/visiblePhotos.js");

beforeEach(() => {
  rows.mockReturnValue([
    { clerkUserId: "ray", avatarUrl: "/objects/uploads/ray" },
    { clerkUserId: "kim", avatarUrl: "/objects/uploads/kim" },
    { clerkUserId: "sam", avatarUrl: null },
  ]);
  blocked.mockResolvedValue(new Set());
});

describe("visiblePhotos", () => {
  it("gives each account's photo, and none for an account without one or a placeholder", async () => {
    const photos = await visiblePhotos("john", ["ray", "kim", "sam", null, undefined]);
    expect(Object.fromEntries(photos)).toEqual({ ray: "/objects/uploads/ray", kim: "/objects/uploads/kim" });
  });

  it("never gives the photo of someone with a block either way", async () => {
    blocked.mockResolvedValue(new Set(["kim"]));
    const photos = await visiblePhotos("john", ["ray", "kim"]);
    expect(photos.has("kim")).toBe(false);
    expect(photos.get("ray")).toBe("/objects/uploads/ray");
  });

  it("asks for nothing when there's no one with an account", async () => {
    rows.mockClear();
    expect((await visiblePhotos("john", [null])).size).toBe(0);
    expect(rows).not.toHaveBeenCalled();
  });
});
