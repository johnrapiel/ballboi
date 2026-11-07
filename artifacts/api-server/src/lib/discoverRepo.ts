// Database reads and writes for Discover (spec: Discover). The rules live in
// discoverPlayers.ts, discoverAvailability.ts and reliability.ts; this file
// only fetches and saves, behind an interface so routes test without a
// database.

import {
  contentReportsTable,
  db,
  discoverProfilesTable,
  matchesTable,
  playersTable,
  userBlocksTable,
  usersTable,
  weeklyAvailabilityTable,
  type ReportReason,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { areaForZip, boundingBox, type Area, type Point } from "./discoverArea.js";
import type { DiscoverCandidate, DiscoverSettingsInput } from "./discoverPlayers.js";
import { countPlayed, EMPTY_RELIABILITY, type Reliability } from "./reliability.js";

export interface DiscoverMe {
  userId: number;
  clerkUserId: string;
  name: string;
  rating: number | null;
  /** Null until the player has a home ZIP Discover can place. */
  area: Area | null;
  /** The saved ZIP, even when Discover couldn't place it. */
  homeZip: string | null;
  hidden: boolean;
  plays: string | null;
  radius: number;
  slots: number[];
}

/** Extra counts a later feature adds to reliability (Discover no-shows, F13). */
export type NoShowCounter = (clerkUserIds: string[]) => Promise<Map<string, number>>;

export interface DiscoverRepo {
  me(clerkUserId: string): Promise<DiscoverMe | null>;
  /** Discoverable players within `miles` of a point: onboarded, shown, not the viewer, not blocked either way, not banned or suspended. */
  near(viewer: string, point: Point, miles: number): Promise<DiscoverCandidate[]>;
  /** One discoverable player by user id, or null when they aren't in Discover for this viewer. */
  person(viewer: string, userId: number): Promise<DiscoverCandidate | null>;
  reliability(clerkUserIds: string[]): Promise<Map<string, Reliability>>;
  saveSettings(clerkUserId: string, input: DiscoverSettingsInput): Promise<void>;
  /** Saves a new home area: the profile's ZIP (exact location dropped) and Discover's point. */
  setArea(clerkUserId: string, area: Area): Promise<void>;
  saveSlots(clerkUserId: string, slots: number[]): Promise<void>;
  /** The account behind a user id, or null. */
  accountForUser(userId: number): Promise<string | null>;
  /** Files a player report from Discover; returns its id. Waits for a moderator like every report. */
  fileReport(input: { reporter: string; subject: string; userId: number; reason: ReportReason; details?: string }): Promise<number>;
  block(viewer: string, target: string): Promise<void>;
  unblock(viewer: string, target: string): Promise<void>;
}

/** Placed in Discover: onboarded, with a point, not hidden. */
const discoverableWhere = sql`
  u.onboarding_complete = true
  AND d.hidden = false
  AND d.area_latitude IS NOT NULL AND d.area_longitude IS NOT NULL`;

/** Not the viewer, not blocked either way, not banned or suspended right now. */
const visibleTo = (viewer: string) => sql`
  u.clerk_user_id <> ${viewer}
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_clerk_user_id = ${viewer} AND b.blocked_clerk_user_id = u.clerk_user_id)
       OR (b.blocker_clerk_user_id = u.clerk_user_id AND b.blocked_clerk_user_id = ${viewer}))
  AND NOT EXISTS (
    SELECT 1 FROM account_sanctions s
    WHERE s.clerk_user_id = u.clerk_user_id AND s.lifted_at IS NULL
      AND (s.ends_at IS NULL OR s.ends_at > now()))`;

type CandidateRow = {
  user_id: number;
  clerk_user_id: string;
  name: string;
  avatar_url: string | null;
  rating: string | number | null;
  rating_source: string | null;
  area_latitude: number;
  area_longitude: number;
  area_town: string | null;
  plays: string | null;
  slots: number[] | null;
};

const candidateSelect = sql`
  SELECT u.id AS user_id, u.clerk_user_id, u.display_name AS name, u.avatar_url, u.rating, u.rating_source,
    d.area_latitude, d.area_longitude, d.area_town, d.plays, w.slots
  FROM users u
  JOIN discover_profiles d ON d.clerk_user_id = u.clerk_user_id
  LEFT JOIN weekly_availability w ON w.clerk_user_id = u.clerk_user_id`;

const toCandidate = (r: CandidateRow): DiscoverCandidate => ({
  userId: Number(r.user_id),
  clerkUserId: r.clerk_user_id,
  name: r.name,
  avatarUrl: r.avatar_url,
  rating: r.rating == null ? null : Number(r.rating),
  ratingSource: r.rating_source,
  point: { latitude: Number(r.area_latitude), longitude: Number(r.area_longitude) },
  town: r.area_town,
  plays: r.plays,
  slots: r.slots ?? [],
});

/** How often the background area refresh may run, at most. */
const SYNC_EVERY_MS = 60_000;

export class DrizzleDiscoverRepo implements DiscoverRepo {
  private lastSync = 0;

  constructor(private readonly noShows: NoShowCounter = async () => new Map()) {}

  /**
   * Gives every account with a home ZIP a Discover point, and refreshes it
   * when the ZIP changed elsewhere (Edit profile, onboarding). At most once a
   * minute; cheap when nothing changed.
   */
  async syncAreas(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastSync < SYNC_EVERY_MS) return;
    this.lastSync = now;
    const stale = await db
      .select({ clerkUserId: usersTable.clerkUserId, zip: usersTable.homeZip })
      .from(usersTable)
      .leftJoin(discoverProfilesTable, eq(discoverProfilesTable.clerkUserId, usersTable.clerkUserId))
      .where(
        and(
          isNotNull(usersTable.homeZip),
          or(isNull(discoverProfilesTable.clerkUserId), sql`${discoverProfilesTable.areaZip} IS DISTINCT FROM ${usersTable.homeZip}`),
        ),
      );
    for (const row of stale) await this.writeArea(row.clerkUserId, areaForZip(row.zip), row.zip);
  }

  private async writeArea(clerkUserId: string, area: Area | null, zip: string | null) {
    const values = {
      areaZip: zip,
      areaTown: area?.town ?? null,
      areaState: area?.state ?? null,
      areaLatitude: area?.point.latitude ?? null,
      areaLongitude: area?.point.longitude ?? null,
    };
    await db
      .insert(discoverProfilesTable)
      .values({ clerkUserId, ...values })
      .onConflictDoUpdate({ target: discoverProfilesTable.clerkUserId, set: values });
  }

  async me(clerkUserId: string): Promise<DiscoverMe | null> {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
    if (!u) return null;
    let [profile] = await db.select().from(discoverProfilesTable).where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
    if (!profile || profile.areaZip !== u.homeZip) {
      await this.writeArea(clerkUserId, areaForZip(u.homeZip), u.homeZip);
      [profile] = await db.select().from(discoverProfilesTable).where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
    }
    const [week] = await db.select().from(weeklyAvailabilityTable).where(eq(weeklyAvailabilityTable.clerkUserId, clerkUserId));
    const area =
      profile?.areaZip && profile.areaLatitude != null && profile.areaLongitude != null
        ? {
            zip: profile.areaZip,
            town: profile.areaTown ?? "",
            state: profile.areaState ?? "",
            point: { latitude: profile.areaLatitude, longitude: profile.areaLongitude },
          }
        : null;
    return {
      userId: u.id,
      clerkUserId,
      name: u.displayName,
      rating: u.rating ?? null,
      area,
      homeZip: u.homeZip,
      hidden: profile?.hidden ?? false,
      plays: profile?.plays ?? null,
      radius: profile?.radiusMiles ?? 10,
      slots: week?.slots ?? [],
    };
  }

  async near(viewer: string, point: Point, miles: number): Promise<DiscoverCandidate[]> {
    await this.syncAreas();
    const box = boundingBox(point, miles);
    const result = await db.execute(sql`${candidateSelect}
      WHERE ${discoverableWhere} AND ${visibleTo(viewer)}
        AND d.area_latitude BETWEEN ${box.minLat} AND ${box.maxLat}
        AND d.area_longitude BETWEEN ${box.minLon} AND ${box.maxLon}`);
    return (result.rows as CandidateRow[]).map(toCandidate);
  }

  async person(viewer: string, userId: number): Promise<DiscoverCandidate | null> {
    await this.syncAreas();
    const result = await db.execute(sql`${candidateSelect}
      WHERE ${discoverableWhere} AND ${visibleTo(viewer)} AND u.id = ${userId}`);
    const row = (result.rows as CandidateRow[])[0];
    return row ? toCandidate(row) : null;
  }

  async reliability(clerkUserIds: string[]): Promise<Map<string, Reliability>> {
    const out = new Map<string, Reliability>();
    const ids = [...new Set(clerkUserIds)];
    if (!ids.length) return out;
    const mine = await db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(inArray(playersTable.clerkUserId, ids));
    const playerIds = mine.map((p) => p.id);
    const matches = playerIds.length
      ? await db
          .select({
            player1Id: matchesTable.player1Id,
            player2Id: matchesTable.player2Id,
            player3Id: matchesTable.player3Id,
            player4Id: matchesTable.player4Id,
            winnerId: matchesTable.winnerId,
          })
          .from(matchesTable)
          .where(
            and(
              eq(matchesTable.status, "completed"),
              isNotNull(matchesTable.score),
              isNull(matchesTable.voidedAt),
              or(
                inArray(matchesTable.player1Id, playerIds),
                inArray(matchesTable.player2Id, playerIds),
                inArray(matchesTable.player3Id, playerIds),
                inArray(matchesTable.player4Id, playerIds),
              ),
            ),
          )
      : [];
    const everyone = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
    const owners = everyone.length
      ? await db.select({ id: playersTable.id, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, everyone))
      : [];
    const ownerOf = new Map(owners.map((o) => [o.id, o.clerkUserId ?? null]));
    const noShows = await this.noShows(ids);
    for (const id of ids) {
      const own = matches.filter((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id].some((p) => p != null && ownerOf.get(p) === id));
      out.set(id, { ...countPlayed(id, own, (p) => ownerOf.get(p) ?? null), noShows: noShows.get(id) ?? 0 });
    }
    return out;
  }

  async saveSettings(clerkUserId: string, input: DiscoverSettingsInput): Promise<void> {
    const set: Partial<typeof discoverProfilesTable.$inferInsert> = {};
    if (input.hidden !== undefined) set.hidden = input.hidden;
    if (input.plays !== undefined) set.plays = input.plays;
    if (input.radius !== undefined) set.radiusMiles = input.radius;
    if (!Object.keys(set).length) return;
    await db
      .insert(discoverProfilesTable)
      .values({ clerkUserId, ...set })
      .onConflictDoUpdate({ target: discoverProfilesTable.clerkUserId, set });
  }

  async setArea(clerkUserId: string, area: Area): Promise<void> {
    // A typed ZIP replaces any earlier "Use my location" point.
    await db
      .update(usersTable)
      .set({ homeZip: area.zip, homeLatitude: null, homeLongitude: null })
      .where(eq(usersTable.clerkUserId, clerkUserId));
    await this.writeArea(clerkUserId, area, area.zip);
  }

  async accountForUser(userId: number): Promise<string | null> {
    const [row] = await db.select({ id: usersTable.clerkUserId }).from(usersTable).where(eq(usersTable.id, userId));
    return row?.id ?? null;
  }

  async fileReport(input: { reporter: string; subject: string; userId: number; reason: ReportReason; details?: string }): Promise<number> {
    const [row] = await db
      .insert(contentReportsTable)
      .values({
        reporterClerkUserId: input.reporter,
        targetType: "player",
        // A Discover player may have no league player row, so the target is their account.
        targetId: `user:${input.userId}`,
        reason: input.reason,
        details: input.details ?? null,
        source: "user",
        subjectClerkUserId: input.subject,
      })
      .returning({ id: contentReportsTable.id });
    return row.id;
  }

  async block(viewer: string, target: string): Promise<void> {
    await db.insert(userBlocksTable).values({ blockerClerkUserId: viewer, blockedClerkUserId: target }).onConflictDoNothing();
  }

  async unblock(viewer: string, target: string): Promise<void> {
    await db
      .delete(userBlocksTable)
      .where(and(eq(userBlocksTable.blockerClerkUserId, viewer), eq(userBlocksTable.blockedClerkUserId, target)));
  }

  async saveSlots(clerkUserId: string, slots: number[]): Promise<void> {
    await db
      .insert(weeklyAvailabilityTable)
      .values({ clerkUserId, slots })
      .onConflictDoUpdate({ target: weeklyAvailabilityTable.clerkUserId, set: { slots } });
  }
}

/** A player's reliability, or nothing played yet when it isn't in the map. */
export const reliabilityOrEmpty = (m: Map<string, Reliability>, id: string): Reliability => m.get(id) ?? EMPTY_RELIABILITY;
