// Database reads and writes for Discover (spec: Discover). The rules live in
// discoverPlayers.ts; this file only fetches and saves.

import { accountSanctionsTable, db, matchesTable, playersTable, userBlocksTable, usersTable } from "@workspace/db";
import { and, between, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";
import { boundingBox, homeAreaPoint, type Point } from "./discoverArea.js";
import type { DiscoverCandidate, DiscoverSettingsInput } from "./discoverPlayers.js";

export interface DiscoverMe {
  userId: number;
  clerkUserId: string;
  /** Null until the player has a home area Discover can place. */
  point: Point | null;
  homeZip: string | null;
  rating: number | null;
  hidden: boolean;
  plays: string | null;
  freeTimes: string[] | null;
}

export type DiscoverPerson = DiscoverCandidate & { clerkUserId: string };

export interface DiscoverRepo {
  me(clerkUserId: string): Promise<DiscoverMe | null>;
  /** Discoverable players within `miles` of a point: onboarded, not hidden, not the viewer, not blocked either way, not banned or suspended. */
  near(viewer: string, point: Point, miles: number): Promise<DiscoverPerson[]>;
  /** One discoverable player by user id, or null when they aren't in Discover for this viewer. */
  person(viewer: string, userId: number): Promise<DiscoverPerson | null>;
  saveSettings(clerkUserId: string, input: DiscoverSettingsInput): Promise<void>;
  /** Blocks a Discover player by user id. False when there's no such account. */
  block(viewer: string, userId: number): Promise<boolean>;
  unblock(viewer: string, userId: number): Promise<void>;
}

const personFields = {
  userId: usersTable.id,
  clerkUserId: usersTable.clerkUserId,
  name: usersTable.displayName,
  avatarUrl: usersTable.avatarUrl,
  rating: usersTable.rating,
  ratingSource: usersTable.ratingSource,
  latitude: usersTable.areaLatitude,
  longitude: usersTable.areaLongitude,
  plays: usersTable.plays,
  freeTimes: usersTable.freeTimes,
};

const discoverable = (viewer: string) =>
  and(
    eq(usersTable.onboardingComplete, true),
    eq(usersTable.discoverHidden, false),
    ne(usersTable.clerkUserId, viewer),
    isNotNull(usersTable.areaLatitude),
    isNotNull(usersTable.areaLongitude),
  );

type Row = { [K in keyof typeof personFields]: unknown };

export class DrizzleDiscoverRepo implements DiscoverRepo {
  async me(clerkUserId: string): Promise<DiscoverMe | null> {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    if (!u) return null;
    const point =
      u.areaLatitude != null && u.areaLongitude != null
        ? { latitude: u.areaLatitude, longitude: u.areaLongitude }
        : homeAreaPoint({ zip: u.homeZip, latitude: u.homeLatitude, longitude: u.homeLongitude });
    return {
      userId: u.id,
      clerkUserId: u.clerkUserId,
      point,
      homeZip: u.homeZip,
      rating: u.rating ?? null,
      hidden: u.discoverHidden,
      plays: u.plays,
      freeTimes: u.freeTimes,
    };
  }

  async near(viewer: string, point: Point, miles: number) {
    const box = boundingBox(point, miles);
    const rows = await db
      .select(personFields)
      .from(usersTable)
      .where(
        and(
          discoverable(viewer),
          between(usersTable.areaLatitude, box.minLat, box.maxLat),
          between(usersTable.areaLongitude, box.minLon, box.maxLon),
        ),
      );
    return this.finish(viewer, rows as Row[]);
  }

  async person(viewer: string, userId: number) {
    const rows = await db
      .select(personFields)
      .from(usersTable)
      .where(and(discoverable(viewer), eq(usersTable.id, userId)));
    return (await this.finish(viewer, rows as Row[]))[0] ?? null;
  }

  /** Drops blocked and sanctioned accounts and adds each player's match count. */
  private async finish(viewer: string, rows: Row[]): Promise<DiscoverPerson[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.clerkUserId as string);
    const now = new Date();
    const [blocked, sanctioned] = await Promise.all([
      blockedAccountsFor(viewer),
      db
        .select({ id: accountSanctionsTable.clerkUserId })
        .from(accountSanctionsTable)
        .where(
          and(
            inArray(accountSanctionsTable.clerkUserId, ids),
            isNull(accountSanctionsTable.liftedAt),
            or(isNull(accountSanctionsTable.endsAt), gt(accountSanctionsTable.endsAt, now)),
          ),
        ),
    ]);
    const out = new Set([...blocked, ...sanctioned.map((s) => s.id)]);
    const kept = rows.filter((r) => !out.has(r.clerkUserId as string));
    const played = await playedCounts(kept.map((r) => r.clerkUserId as string));
    return kept.map((r) => ({
      userId: r.userId as number,
      clerkUserId: r.clerkUserId as string,
      name: r.name as string,
      avatarUrl: (r.avatarUrl as string | null) ?? null,
      rating: (r.rating as number | null) ?? null,
      ratingSource: (r.ratingSource as string | null) ?? null,
      point: { latitude: r.latitude as number, longitude: r.longitude as number },
      plays: (r.plays as string | null) ?? null,
      freeTimes: (r.freeTimes as string[] | null) ?? null,
      played: played.get(r.clerkUserId as string) ?? 0,
    }));
  }

  async saveSettings(clerkUserId: string, input: DiscoverSettingsInput) {
    const set: Partial<typeof usersTable.$inferInsert> = {};
    if (input.hidden !== undefined) set.discoverHidden = input.hidden;
    if (input.plays !== undefined) set.plays = input.plays;
    if (input.freeTimes !== undefined) set.freeTimes = input.freeTimes;
    if (!Object.keys(set).length) return;
    await db.update(usersTable).set(set).where(eq(usersTable.clerkUserId, clerkUserId));
  }

  private async accountFor(userId: number) {
    const [u] = await db.select({ id: usersTable.clerkUserId }).from(usersTable).where(eq(usersTable.id, userId));
    return u?.id ?? null;
  }

  async block(viewer: string, userId: number) {
    const target = await this.accountFor(userId);
    if (!target || target === viewer) return false;
    await db.insert(userBlocksTable).values({ blockerClerkUserId: viewer, blockedClerkUserId: target }).onConflictDoNothing();
    return true;
  }

  async unblock(viewer: string, userId: number) {
    const target = await this.accountFor(userId);
    if (!target) return;
    await db
      .delete(userBlocksTable)
      .where(and(eq(userBlocksTable.blockerClerkUserId, viewer), eq(userBlocksTable.blockedClerkUserId, target)));
  }
}

/** Completed, not voided matches per account, across every league and Quick match. */
export async function playedCounts(clerkUserIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!clerkUserIds.length) return counts;
  const players = await db
    .select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId })
    .from(playersTable)
    .where(inArray(playersTable.clerkUserId, clerkUserIds));
  if (!players.length) return counts;
  const ownerOf = new Map(players.map((p) => [p.id, p.clerkUserId!]));
  const ids = [...ownerOf.keys()];
  const matches = await db
    .select({
      id: matchesTable.id,
      p1: matchesTable.player1Id,
      p2: matchesTable.player2Id,
      p3: matchesTable.player3Id,
      p4: matchesTable.player4Id,
    })
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.status, "completed"),
        isNull(matchesTable.voidedAt),
        or(
          inArray(matchesTable.player1Id, ids),
          inArray(matchesTable.player2Id, ids),
          inArray(matchesTable.player3Id, ids),
          inArray(matchesTable.player4Id, ids),
        ),
      ),
    );
  for (const m of matches) {
    // One match counts once per account, even if both sides were somehow theirs.
    const owners = new Set([m.p1, m.p2, m.p3, m.p4].map((p) => (p == null ? undefined : ownerOf.get(p))).filter(Boolean) as string[]);
    for (const o of owners) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fills the Discover point for accounts saved before Discover existed, once,
 * on start. New home areas set it as they're saved.
 */
export async function backfillDiscoverAreas(): Promise<number> {
  const rows = await db
    .select({ id: usersTable.id, zip: usersTable.homeZip, latitude: usersTable.homeLatitude, longitude: usersTable.homeLongitude })
    .from(usersTable)
    .where(and(isNotNull(usersTable.homeZip), isNull(usersTable.areaLatitude)));
  let filled = 0;
  for (const r of rows) {
    const p = homeAreaPoint(r);
    if (!p) continue;
    await db.update(usersTable).set({ areaLatitude: p.latitude, areaLongitude: p.longitude }).where(eq(usersTable.id, r.id));
    filled++;
  }
  return filled;
}
