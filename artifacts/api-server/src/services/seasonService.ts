import { db } from "@workspace/db";
import { seasonsTable, matchesTable } from "@workspace/db";
import { or, isNull, eq, and, lte, gte, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Checks whether a proposed date range overlaps with any existing season visible
 * to the given league (own seasons + global seasons). Excludes `excludeId` so
 * PATCH operations can skip the season being updated.
 *
 * Returns the conflicting season if one is found, or null if clear.
 */
export async function findOverlappingSeason(
  leagueId: number | null,
  startDate: string,
  endDate: string,
  excludeId?: number,
): Promise<{ id: number; name: string; startDate: string; endDate: string } | null> {
  // A global season (leagueId === null) is visible to every league, so it can
  // conflict with any season in the system. A league season is visible to its own
  // league plus global seasons. In both cases we check the full relevant set.
  // When leagueId is null: check ALL seasons (global + any per-league).
  // When leagueId is set: check global + that league's own seasons.
  const visibilityFilter =
    leagueId != null
      ? or(isNull(seasonsTable.leagueId), eq(seasonsTable.leagueId, leagueId))!
      : undefined; // no filter needed — check every season

  // Build filter conditions as an array so undefined visibilityFilter is cleanly skipped
  const conditions = [
    visibilityFilter,
    lte(seasonsTable.startDate, endDate),
    gte(seasonsTable.endDate, startDate),
    excludeId != null ? ne(seasonsTable.id, excludeId) : undefined,
  ].filter(Boolean) as Parameters<typeof and>;

  const baseFilter = and(...conditions)!;

  const rows = await db
    .select({
      id: seasonsTable.id,
      name: seasonsTable.name,
      startDate: seasonsTable.startDate,
      endDate: seasonsTable.endDate,
    })
    .from(seasonsTable)
    .where(baseFilter)
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Returns the name of the currently active season for a given league,
 * checking per-league seasons first, then global (null leagueId) seasons.
 * A season is active if today falls within [startDate, endDate] inclusive.
 */
export async function getAutoSeason(leagueId?: number | null): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);

  if (leagueId != null) {
    const leagueSeasons = await db
      .select()
      .from(seasonsTable)
      .where(eq(seasonsTable.leagueId, leagueId));
    const active = leagueSeasons.find((s) => s.startDate <= today && s.endDate >= today);
    if (active) return active.name;
  }

  const globalSeasons = await db
    .select()
    .from(seasonsTable)
    .where(isNull(seasonsTable.leagueId));
  const active = globalSeasons.find((s) => s.startDate <= today && s.endDate >= today);

  return active?.name ?? null;
}

/**
 * Returns the names of all seasons that are fully in the past (endDate < today)
 * visible to a given league (own + global). Used to exclude past-season matches from standings.
 */
export async function getPastSeasonNames(leagueId: number): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ name: seasonsTable.name, endDate: seasonsTable.endDate })
    .from(seasonsTable)
    .where(or(isNull(seasonsTable.leagueId), eq(seasonsTable.leagueId, leagueId))!);

  return rows.filter((s) => s.endDate < today).map((s) => s.name);
}

/**
 * Returns all seasons visible to a league (own + global), with isActive computed.
 */
export async function getSeasonsForLeague(leagueId: number) {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(seasonsTable)
    .where(or(isNull(seasonsTable.leagueId), eq(seasonsTable.leagueId, leagueId))!);

  return rows.map((s) => ({
    id: s.id,
    leagueId: s.leagueId ?? null,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    isActive: s.startDate <= today && s.endDate >= today,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}

/**
 * Idempotent startup routine.
 *
 * Step 1 — Clean Spring Exhibition: if the Spring Exhibition global season
 * still exists, delete all matches tagged to it (FK cascades handle
 * match_shots, ball_boi_sessions, match_statistics, match_reminders_log)
 * then remove the season row itself.
 *
 * Step 2 — Seed Summer League: if no global seasons remain, insert the
 * Summer League season.
 *
 * Safe to call on every boot — both steps are no-ops once applied.
 */
export async function seedGlobalData(): Promise<void> {
  // Step 1: clean up Spring Exhibition data
  const springRows = await db
    .select({ id: seasonsTable.id })
    .from(seasonsTable)
    .where(
      and(
        isNull(seasonsTable.leagueId),
        eq(seasonsTable.name, "Spring Exhibition"),
      ),
    )
    .limit(1);

  if (springRows.length > 0) {
    const { rowCount: matchesDeleted } = await db
      .delete(matchesTable)
      .where(eq(matchesTable.season, "Spring Exhibition"));

    await db
      .delete(seasonsTable)
      .where(
        and(
          isNull(seasonsTable.leagueId),
          eq(seasonsTable.name, "Spring Exhibition"),
        ),
      );

    logger.info(
      { matchesDeleted },
      "seedGlobalData: deleted Spring Exhibition season and matches",
    );
  }

  // Step 2: seed Summer League if no global season exists yet
  const existingGlobal = await db
    .select({ id: seasonsTable.id })
    .from(seasonsTable)
    .where(isNull(seasonsTable.leagueId))
    .limit(1);

  if (existingGlobal.length === 0) {
    await db.insert(seasonsTable).values([
      {
        leagueId: null,
        name: "Summer League",
        startDate: "2026-06-01",
        endDate: "2026-08-24",
      },
    ]);
    logger.info("seedGlobalData: inserted Summer League season");
  }
}
