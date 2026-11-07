// Database reads and writes for open matches. The rules live in openMatch.ts.

import {
  db,
  directoryCourtsTable,
  matchesTable,
  openMatchAlertsTable,
  openMatchesTable,
  openMatchMessagesTable,
  openMatchPlayersTable,
  playersTable,
  usersTable,
  type OpenMatch,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { boundingBox, type Point } from "./discoverArea.js";
import type { NewOpenMatch, OpenMatchRow } from "./openMatch.js";

export type JoinResult = "joined" | "filled" | "full" | "closed" | "already" | "own";

export interface OpenMatchMessage {
  id: number;
  senderClerkUserId: string | null;
  text: string;
  createdAt: Date;
}

export interface OpenMatchRepo {
  near(viewer: string, point: Point, miles: number, now: Date): Promise<OpenMatchRow[]>;
  one(id: number): Promise<(OpenMatchRow & { matchId: number | null }) | null>;
  create(poster: string, m: NewOpenMatch, courtName: string | null, point: Point): Promise<number>;
  join(id: number, clerkUserId: string, now: Date): Promise<JoinResult>;
  leave(id: number, clerkUserId: string, how: "dropped" | "removed", now: Date): Promise<boolean>;
  cancel(id: number, now: Date): Promise<void>;
  messages(id: number, afterId: number): Promise<OpenMatchMessage[]>;
  send(id: number, sender: string | null, text: string): Promise<OpenMatchMessage>;
  /** Matches you posted or hold a spot in, still to play. */
  mine(clerkUserId: string, now: Date): Promise<OpenMatchRow[]>;
  /** "This match filled up" notices for players a poster removed; read once. */
  takeNotices(clerkUserId: string): Promise<OpenMatchRow[]>;
  people(clerkUserIds: string[]): Promise<Map<string, { userId: number; name: string; rating: number | null }>>;
  courtName(courtId: number): Promise<string | null>;
  isBlocked(a: string, b: string): Promise<boolean>;
  alertCandidates(since: Date): Promise<{ clerkUserId: string; point: Point; radius: number; rating: number | null; sentToday: number }[]>;
  logAlerts(clerkUserIds: string[], openMatchId: number): Promise<void>;
}

type Raw = OpenMatch & { posterName: string | null };

async function hydrate(rows: Raw[]): Promise<OpenMatchRow[]> {
  if (!rows.length) return [];
  const players = await db
    .select({ id: openMatchPlayersTable.openMatchId, clerkUserId: openMatchPlayersTable.clerkUserId })
    .from(openMatchPlayersTable)
    .where(and(inArray(openMatchPlayersTable.openMatchId, rows.map((r) => r.id)), eq(openMatchPlayersTable.status, "in")))
    .orderBy(asc(openMatchPlayersTable.joinedAt));
  return rows.map((r) => ({
    id: r.id,
    posterClerkUserId: r.posterClerkUserId,
    posterName: r.posterName?.trim() || "A player",
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    timeZone: r.timeZone,
    courtName: r.courtName,
    format: r.format,
    spots: r.spots,
    minRating: r.minRating,
    maxRating: r.maxRating,
    note: r.note,
    status: r.status,
    point: { latitude: r.areaLatitude, longitude: r.areaLongitude },
    joined: players.filter((p) => p.id === r.id).map((p) => p.clerkUserId),
  }));
}

const selectRaw = () =>
  db
    .select({ m: openMatchesTable, posterName: usersTable.displayName })
    .from(openMatchesTable)
    .leftJoin(usersTable, eq(usersTable.clerkUserId, openMatchesTable.posterClerkUserId));

const flat = (rows: { m: OpenMatch; posterName: string | null }[]): Raw[] => rows.map((r) => ({ ...r.m, posterName: r.posterName }));

/** The league-free player row for an account, made when they have none. */
async function playerRowFor(clerkUserId: string): Promise<number> {
  const rows = await db.select({ id: playersTable.id, leagueId: playersTable.leagueId }).from(playersTable).where(eq(playersTable.clerkUserId, clerkUserId));
  const free = rows.find((r) => r.leagueId == null);
  if (free) return free.id;
  const [user] = await db.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  const [created] = await db.insert(playersTable).values({ name: user?.name ?? "Player", clerkUserId }).returning({ id: playersTable.id });
  return created.id;
}

async function voidMatch(matchId: number | null, now: Date) {
  if (matchId == null) return;
  await db.update(matchesTable).set({ status: "canceled", voidedAt: now }).where(and(eq(matchesTable.id, matchId), isNull(matchesTable.score)));
}

export class DrizzleOpenMatchRepo implements OpenMatchRepo {
  async near(viewer: string, point: Point, miles: number, now: Date) {
    const box = boundingBox(point, miles);
    const rows = await selectRaw().where(
      and(
        eq(openMatchesTable.status, "open"),
        gt(openMatchesTable.startsAt, now),
        sql`${openMatchesTable.areaLatitude} BETWEEN ${box.minLat} AND ${box.maxLat}`,
        sql`${openMatchesTable.areaLongitude} BETWEEN ${box.minLon} AND ${box.maxLon}`,
        sql`NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_clerk_user_id = ${viewer} AND b.blocked_clerk_user_id = ${openMatchesTable.posterClerkUserId})
             OR (b.blocker_clerk_user_id = ${openMatchesTable.posterClerkUserId} AND b.blocked_clerk_user_id = ${viewer}))`,
      ),
    );
    return hydrate(flat(rows));
  }

  async one(id: number) {
    const rows = await selectRaw().where(eq(openMatchesTable.id, id));
    const [row] = await hydrate(flat(rows));
    return row ? { ...row, matchId: rows[0].m.matchId } : null;
  }

  async create(poster: string, m: NewOpenMatch, courtName: string | null, point: Point) {
    const [row] = await db
      .insert(openMatchesTable)
      .values({
        posterClerkUserId: poster,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        timeZone: m.timeZone,
        courtId: m.courtId,
        courtName,
        format: m.format,
        spots: m.spots,
        minRating: m.minRating,
        maxRating: m.maxRating,
        note: m.note,
        areaLatitude: point.latitude,
        areaLongitude: point.longitude,
      })
      .returning({ id: openMatchesTable.id });
    return row.id;
  }

  async join(id: number, clerkUserId: string, now: Date): Promise<JoinResult> {
    const outcome = await db.transaction(async (tx) => {
      // One join at a time per match, so the last spot can only go once.
      const locked = await tx.execute(sql`SELECT * FROM open_matches WHERE id = ${id} FOR UPDATE`);
      const m = locked.rows[0] as { status: string; starts_at: string | Date; poster_clerk_user_id: string; spots: number } | undefined;
      if (!m || m.status === "canceled" || new Date(m.starts_at) <= now) return { result: "closed" as const };
      if (m.poster_clerk_user_id === clerkUserId) return { result: "own" as const };
      const players = await tx.select().from(openMatchPlayersTable).where(eq(openMatchPlayersTable.openMatchId, id));
      if (players.some((p) => p.clerkUserId === clerkUserId && p.status === "in")) return { result: "already" as const };
      const taken = players.filter((p) => p.status === "in").length;
      if (m.status === "full" || taken >= Number(m.spots)) return { result: "full" as const };
      const mine = players.find((p) => p.clerkUserId === clerkUserId);
      if (mine) {
        await tx.update(openMatchPlayersTable).set({ status: "in", joinedAt: now, leftAt: null, noticePending: false }).where(eq(openMatchPlayersTable.id, mine.id));
      } else {
        await tx.insert(openMatchPlayersTable).values({ openMatchId: id, clerkUserId, joinedAt: now });
      }
      const fills = taken + 1 >= Number(m.spots);
      if (fills) await tx.update(openMatchesTable).set({ status: "full", filledAt: now }).where(eq(openMatchesTable.id, id));
      return { result: fills ? ("filled" as const) : ("joined" as const) };
    });
    if (outcome.result === "filled") await this.makeMatch(id);
    return outcome.result;
  }

  /** The filled match goes on everyone's schedule as a match row (no league). */
  private async makeMatch(id: number) {
    const m = await this.one(id);
    if (!m) return;
    const ids = await Promise.all([m.posterClerkUserId, ...m.joined].map(playerRowFor));
    const [match] = await db
      .insert(matchesTable)
      .values({
        player1Id: ids[0],
        player2Id: ids[1],
        player3Id: ids[2] ?? null,
        player4Id: ids[3] ?? null,
        scheduledAt: m.startsAt.toISOString(),
        location: m.courtName,
        status: "scheduled",
        generatedFrom: "discover_open_match",
      })
      .returning({ id: matchesTable.id });
    await db.update(openMatchesTable).set({ matchId: match.id }).where(eq(openMatchesTable.id, id));
  }

  async leave(id: number, clerkUserId: string, how: "dropped" | "removed", now: Date) {
    const m = await this.one(id);
    if (!m || !m.joined.includes(clerkUserId)) return false;
    await db
      .update(openMatchPlayersTable)
      .set({ status: how, leftAt: now, noticePending: how === "removed" })
      .where(and(eq(openMatchPlayersTable.openMatchId, id), eq(openMatchPlayersTable.clerkUserId, clerkUserId)));
    if (m.status === "full") {
      // The spot reopens in Discover; the schedule entry waits until it fills again.
      await voidMatch(m.matchId, now);
      await db.update(openMatchesTable).set({ status: "open", filledAt: null, matchId: null }).where(eq(openMatchesTable.id, id));
    }
    return true;
  }

  async cancel(id: number, now: Date) {
    const m = await this.one(id);
    await db.update(openMatchesTable).set({ status: "canceled", canceledAt: now }).where(eq(openMatchesTable.id, id));
    await voidMatch(m?.matchId ?? null, now);
  }

  async messages(id: number, afterId: number) {
    return db
      .select({
        id: openMatchMessagesTable.id,
        senderClerkUserId: openMatchMessagesTable.senderClerkUserId,
        text: openMatchMessagesTable.text,
        createdAt: openMatchMessagesTable.createdAt,
      })
      .from(openMatchMessagesTable)
      .where(and(eq(openMatchMessagesTable.openMatchId, id), gt(openMatchMessagesTable.id, afterId)))
      .orderBy(asc(openMatchMessagesTable.id))
      .limit(200);
  }

  async send(id: number, sender: string | null, text: string) {
    const [row] = await db.insert(openMatchMessagesTable).values({ openMatchId: id, senderClerkUserId: sender, text }).returning();
    return { id: row.id, senderClerkUserId: row.senderClerkUserId, text: row.text, createdAt: row.createdAt };
  }

  async mine(clerkUserId: string, now: Date) {
    const since = new Date(now.getTime() - 3 * 3_600_000);
    const rows = await selectRaw().where(
      and(
        inArray(openMatchesTable.status, ["open", "full"]),
        gt(openMatchesTable.endsAt, since),
        sql`(${openMatchesTable.posterClerkUserId} = ${clerkUserId} OR EXISTS (
          SELECT 1 FROM open_match_players p WHERE p.open_match_id = ${openMatchesTable.id} AND p.clerk_user_id = ${clerkUserId} AND p.status = 'in'))`,
      ),
    );
    return hydrate(flat(rows));
  }

  async takeNotices(clerkUserId: string) {
    const pending = await db
      .update(openMatchPlayersTable)
      .set({ noticePending: false })
      .where(and(eq(openMatchPlayersTable.clerkUserId, clerkUserId), eq(openMatchPlayersTable.noticePending, true)))
      .returning({ id: openMatchPlayersTable.openMatchId });
    if (!pending.length) return [];
    return hydrate(flat(await selectRaw().where(inArray(openMatchesTable.id, pending.map((p) => p.id)))));
  }

  async people(clerkUserIds: string[]) {
    const out = new Map<string, { userId: number; name: string; rating: number | null }>();
    if (!clerkUserIds.length) return out;
    const rows = await db
      .select({ clerkUserId: usersTable.clerkUserId, userId: usersTable.id, name: usersTable.displayName, rating: usersTable.rating })
      .from(usersTable)
      .where(inArray(usersTable.clerkUserId, clerkUserIds));
    for (const r of rows) out.set(r.clerkUserId, { userId: r.userId, name: r.name?.trim() || "Player", rating: r.rating ?? null });
    return out;
  }

  async courtName(courtId: number) {
    const [c] = await db.select({ name: directoryCourtsTable.name }).from(directoryCourtsTable).where(eq(directoryCourtsTable.id, courtId));
    return c?.name ?? null;
  }

  async isBlocked(a: string, b: string) {
    const result = await db.execute(sql`
      SELECT 1 FROM user_blocks
      WHERE (blocker_clerk_user_id = ${a} AND blocked_clerk_user_id = ${b})
         OR (blocker_clerk_user_id = ${b} AND blocked_clerk_user_id = ${a}) LIMIT 1`);
    return result.rows.length > 0;
  }

  async alertCandidates(since: Date) {
    const result = await db.execute(sql`
      SELECT d.clerk_user_id, d.area_latitude, d.area_longitude, d.radius_miles, u.rating,
        (SELECT count(*) FROM open_match_alerts a WHERE a.clerk_user_id = d.clerk_user_id AND a.sent_at > ${since}) AS sent_today
      FROM discover_profiles d JOIN users u ON u.clerk_user_id = d.clerk_user_id
      WHERE d.match_alerts = true AND d.area_latitude IS NOT NULL AND d.area_longitude IS NOT NULL`);
    return (result.rows as Record<string, unknown>[]).map((r) => ({
      clerkUserId: String(r.clerk_user_id),
      point: { latitude: Number(r.area_latitude), longitude: Number(r.area_longitude) },
      radius: Number(r.radius_miles),
      rating: r.rating == null ? null : Number(r.rating),
      sentToday: Number(r.sent_today),
    }));
  }

  async logAlerts(clerkUserIds: string[], openMatchId: number) {
    if (!clerkUserIds.length) return;
    await db.insert(openMatchAlertsTable).values(clerkUserIds.map((clerkUserId) => ({ clerkUserId, openMatchId })));
  }
}
