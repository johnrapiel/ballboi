import { db, playersTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ratingValue } from "./pairing.js";

// The profile is the one source of a signed-up player's name, photo and level
// (Wave 1 review A1, S6). A league player row keeps its own name and
// skillLevel only for placeholder players an admin added who aren't on Ball
// Boi yet. Once a row is linked to an account (clerkUserId), leagues read the
// account's current profile: rosters, pairings, Manage and requests.
//
// The level is the player's self-rated level (users.rating, NTRP scale). Only
// the player changes it, in Edit profile; match results never move it. A
// verified source (USTA, NTRP or UTR) may set it later, which is what
// ratingSource is for.

export type PlayerProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
};
export type ProfileMap = Map<string, PlayerProfile>;

/** A level with where it came from, for the level badge. */
export type PlayerLevel = { rating: number; source: "self" | "verified" };

type Linkable = { clerkUserId?: string | null };

/** Profiles for these accounts, keyed by clerkUserId. Nulls are skipped. */
export async function loadProfiles(clerkUserIds: (string | null | undefined)[]): Promise<ProfileMap> {
  const ids = [...new Set(clerkUserIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      clerkUserId: usersTable.clerkUserId,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      rating: usersTable.rating,
      ratingSource: usersTable.ratingSource,
    })
    .from(usersTable)
    .where(inArray(usersTable.clerkUserId, ids));
  return new Map(
    rows.map((r) => [
      r.clerkUserId,
      {
        displayName: r.displayName ?? null,
        avatarUrl: r.avatarUrl ?? null,
        rating: r.rating == null ? null : Number(r.rating),
        ratingSource: r.ratingSource ?? null,
      },
    ]),
  );
}

function profileOf(p: Linkable, profiles: ProfileMap): PlayerProfile | undefined {
  return p.clerkUserId ? profiles.get(p.clerkUserId) : undefined;
}

/** The profile name for a signed-up player, else the name on the league row. */
export function playerDisplayName(p: Linkable & { name: string }, profiles: ProfileMap): string {
  return profileOf(p, profiles)?.displayName?.trim() || p.name;
}

/** The profile photo for a signed-up player. Placeholders have none. */
export function playerAvatarUrl(p: Linkable, profiles: ProfileMap): string | null {
  return profileOf(p, profiles)?.avatarUrl ?? null;
}

/** A signed-up player's profile level and its source, or null if they haven't set one. */
export function playerProfileLevel(p: Linkable, profiles: ProfileMap): PlayerLevel | null {
  const profile = profileOf(p, profiles);
  if (!profile || profile.rating == null || !Number.isFinite(profile.rating)) return null;
  return { rating: profile.rating, source: profile.ratingSource === "verified" ? "verified" : "self" };
}

/**
 * The level leagues use. A signed-up player's profile level; a placeholder's
 * admin-set level. A signed-up player who hasn't set a level yet keeps the row's
 * level (3.0 unless an admin set one before they claimed the spot).
 */
export function playerLevelValue(p: Linkable & { skillLevel: string | null }, profiles: ProfileMap): number {
  return playerProfileLevel(p, profiles)?.rating ?? ratingValue(p.skillLevel);
}

/** playerLevelValue as "3.5", for the older skillLevel fields. */
export function playerLevelText(p: Linkable & { skillLevel: string | null }, profiles: ProfileMap): string {
  return playerLevelValue(p, profiles).toFixed(1);
}

/** The signed-in person's profile name, for a new league row; falls back to what the app sent. */
export async function profileNameFor(clerkUserId: string, fallback: string): Promise<string> {
  const profiles = await loadProfiles([clerkUserId]);
  return profiles.get(clerkUserId)?.displayName?.trim() || fallback;
}

/**
 * Copies a player's profile name onto their league rows, so screens that read
 * the row directly (standings, scores, notifications) match the profile too.
 * The rows are a cache: rosters, pairings and Manage read the profile itself.
 */
export async function syncProfileName(clerkUserId: string, displayName: string | null | undefined): Promise<void> {
  const name = displayName?.trim();
  if (!name) return;
  await db.update(playersTable).set({ name }).where(eq(playersTable.clerkUserId, clerkUserId)).returning({ id: playersTable.id });
}
