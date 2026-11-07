// Database reads and writes for the court directory. The rules live in
// courtDirectory.ts.

import { db, directoryCourtsTable, discoverProfilesTable } from "@workspace/db";
import { and, between, eq, gt, ilike, or, sql } from "drizzle-orm";
import type { CourtRow, NewCourt } from "./courtDirectory.js";
import { boundingBox, type Point } from "./discoverArea.js";

export interface CourtRepo {
  /** Courts within `miles` of a point. */
  near(point: Point, miles: number): Promise<CourtRow[]>;
  /** Courts anywhere whose name or address has this text, for a search with no area. */
  search(q: string, limit: number): Promise<CourtRow[]>;
  one(id: number): Promise<CourtRow | null>;
  inZip(zip: string): Promise<CourtRow[]>;
  addedToday(clerkUserId: string): Promise<number>;
  add(clerkUserId: string, court: NewCourt): Promise<CourtRow>;
  /** Your home court, or null to clear it. */
  setHomeCourt(clerkUserId: string, courtId: number | null): Promise<void>;
  homeCourt(clerkUserId: string): Promise<CourtRow | null>;
}

const fields = {
  id: directoryCourtsTable.id,
  name: directoryCourtsTable.name,
  address: directoryCourtsTable.address,
  zip: directoryCourtsTable.zip,
  town: directoryCourtsTable.town,
  latitude: directoryCourtsTable.latitude,
  longitude: directoryCourtsTable.longitude,
};

export class DrizzleCourtRepo implements CourtRepo {
  async near(point: Point, miles: number) {
    const box = boundingBox(point, miles);
    return db
      .select(fields)
      .from(directoryCourtsTable)
      .where(and(between(directoryCourtsTable.latitude, box.minLat, box.maxLat), between(directoryCourtsTable.longitude, box.minLon, box.maxLon)));
  }

  async search(q: string, limit: number) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return db
      .select(fields)
      .from(directoryCourtsTable)
      .where(or(ilike(directoryCourtsTable.name, like), ilike(directoryCourtsTable.address, like)))
      .limit(limit);
  }

  async one(id: number) {
    const [row] = await db.select(fields).from(directoryCourtsTable).where(eq(directoryCourtsTable.id, id));
    return row ?? null;
  }

  async inZip(zip: string) {
    return db.select(fields).from(directoryCourtsTable).where(eq(directoryCourtsTable.zip, zip));
  }

  async addedToday(clerkUserId: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(directoryCourtsTable)
      .where(and(eq(directoryCourtsTable.addedByClerkUserId, clerkUserId), gt(directoryCourtsTable.createdAt, new Date(Date.now() - 86_400_000))));
    return Number(row?.n ?? 0);
  }

  async add(clerkUserId: string, c: NewCourt) {
    const [row] = await db
      .insert(directoryCourtsTable)
      .values({
        name: c.name,
        address: c.address,
        zip: c.zip,
        town: c.town,
        latitude: c.point.latitude,
        longitude: c.point.longitude,
        addedByClerkUserId: clerkUserId,
      })
      .returning(fields);
    return row;
  }

  async setHomeCourt(clerkUserId: string, courtId: number | null) {
    await db
      .insert(discoverProfilesTable)
      .values({ clerkUserId, homeCourtId: courtId })
      .onConflictDoUpdate({ target: discoverProfilesTable.clerkUserId, set: { homeCourtId: courtId } });
  }

  async homeCourt(clerkUserId: string) {
    const [row] = await db
      .select(fields)
      .from(discoverProfilesTable)
      .innerJoin(directoryCourtsTable, eq(directoryCourtsTable.id, discoverProfilesTable.homeCourtId))
      .where(eq(discoverProfilesTable.clerkUserId, clerkUserId));
    return row ?? null;
  }
}
