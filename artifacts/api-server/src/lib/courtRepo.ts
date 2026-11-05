// Database reads and writes for the court directory. Rules live in courtDirectory.ts.

import { db, directoryCourtsTable, usersTable } from "@workspace/db";
import { and, between, count, eq, gt, isNull } from "drizzle-orm";

import type { CourtRow, NewCourt } from "./courtDirectory.js";
import { boundingBox, type Point } from "./discoverArea.js";

export interface CourtRepo {
  /** Visible courts within `miles` of a point. */
  near(point: Point, miles: number): Promise<CourtRow[]>;
  /** A visible court, or null. */
  byId(id: number): Promise<CourtRow | null>;
  addedSince(clerkUserId: string, since: Date): Promise<number>;
  create(clerkUserId: string, court: NewCourt): Promise<CourtRow>;
  /** False when there's no such visible court. */
  setHomeCourt(clerkUserId: string, courtId: number | null): Promise<boolean>;
  /** Moderators: hide or show a court. False when there's no such court. */
  setHidden(courtId: number, hidden: boolean): Promise<boolean>;
}

// A function, so importing this file doesn't touch the table (tests mock @workspace/db).
const fields = () => ({
  id: directoryCourtsTable.id,
  name: directoryCourtsTable.name,
  place: directoryCourtsTable.place,
  zip: directoryCourtsTable.zip,
  latitude: directoryCourtsTable.latitude,
  longitude: directoryCourtsTable.longitude,
  access: directoryCourtsTable.access,
  surface: directoryCourtsTable.surface,
  lights: directoryCourtsTable.lights,
  courtCount: directoryCourtsTable.courtCount,
});

export class DrizzleCourtRepo implements CourtRepo {
  async near(point: Point, miles: number) {
    const box = boundingBox(point, miles);
    return db
      .select(fields())
      .from(directoryCourtsTable)
      .where(
        and(
          isNull(directoryCourtsTable.hiddenAt),
          between(directoryCourtsTable.latitude, box.minLat, box.maxLat),
          between(directoryCourtsTable.longitude, box.minLon, box.maxLon),
        ),
      );
  }

  async byId(id: number) {
    const [c] = await db
      .select(fields())
      .from(directoryCourtsTable)
      .where(and(eq(directoryCourtsTable.id, id), isNull(directoryCourtsTable.hiddenAt)));
    return c ?? null;
  }

  async addedSince(clerkUserId: string, since: Date) {
    const [r] = await db
      .select({ n: count() })
      .from(directoryCourtsTable)
      .where(and(eq(directoryCourtsTable.addedByClerkUserId, clerkUserId), gt(directoryCourtsTable.createdAt, since)));
    return Number(r?.n ?? 0);
  }

  async create(clerkUserId: string, court: NewCourt) {
    const [c] = await db
      .insert(directoryCourtsTable)
      .values({
        name: court.name,
        place: court.place,
        zip: court.zip,
        latitude: court.point.latitude,
        longitude: court.point.longitude,
        access: court.access,
        surface: court.surface,
        lights: court.lights,
        courtCount: court.courtCount,
        addedByClerkUserId: clerkUserId,
      })
      .returning(fields());
    return c;
  }

  async setHomeCourt(clerkUserId: string, courtId: number | null) {
    if (courtId !== null && !(await this.byId(courtId))) return false;
    await db.update(usersTable).set({ homeCourtId: courtId }).where(eq(usersTable.clerkUserId, clerkUserId));
    return true;
  }

  async setHidden(courtId: number, hidden: boolean) {
    const rows = await db
      .update(directoryCourtsTable)
      .set({ hiddenAt: hidden ? new Date() : null })
      .where(eq(directoryCourtsTable.id, courtId))
      .returning({ id: directoryCourtsTable.id });
    return rows.length > 0;
  }
}

/** Who added a court, for the Moderation screen. Null when unknown or deleted. */
export async function courtAdder(courtId: string): Promise<string | null> {
  const id = Number(courtId);
  if (!Number.isInteger(id)) return null;
  const [c] = await db
    .select({ by: directoryCourtsTable.addedByClerkUserId })
    .from(directoryCourtsTable)
    .where(eq(directoryCourtsTable.id, id));
  return c?.by ?? null;
}

/** A visible court's id and name, for a player's home court. */
export async function homeCourtFor(courtId: number | null | undefined): Promise<{ courtId: number; name: string } | null> {
  if (courtId == null) return null;
  const [c] = await db
    .select({ courtId: directoryCourtsTable.id, name: directoryCourtsTable.name })
    .from(directoryCourtsTable)
    .where(and(eq(directoryCourtsTable.id, courtId), isNull(directoryCourtsTable.hiddenAt)));
  return c ?? null;
}
