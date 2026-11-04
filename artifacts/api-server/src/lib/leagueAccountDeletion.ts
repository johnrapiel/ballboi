// Account deletion for league data this feature creates (App Store 5.1.1(v)).
// Called from deleteAccount() in accountDeletion.ts, inside its transaction.
//
// - A league the person runs alone gets a new admin, so it keeps running
//   (Wave 1 review S4, John's call): the member they picked on the Delete
//   account screen, or, if they skipped, the longest-standing member. The new
//   admin takes over the same role (the owner's successor is the owner).
//   Deletion is never blocked: a league with no one to take over just loses
//   its admin.
// - Their admin roles go: the person no longer runs any league. A league they
//   created loses its creator link too, so nothing falls back to their ID.
// - Requests to join and waitlist spots go: they hold the person's name.
// Their league player rows are anonymized by deleteAccount() itself, so
// opponents' results and standings stay correct.

import { db, leagueAdminsTable, leagueJoinRequestsTable, leaguesTable, playersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { LeagueRole } from "./leagueRoles.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction: anything that can select. */
type Reader = Pick<Tx, "select">;

/** A player row in a league, as far as handing the league over goes. */
export interface LeagueMember {
  playerId: number;
  clerkUserId: string | null;
  name: string;
  leftAt: Date | null;
  createdAt: Date;
}

/**
 * Who can take a league over from `leavingUserId`: members still playing,
 * with a Ball Boi account, other than the person leaving. Longest-standing
 * first (earliest join, then lowest player ID), one row per person.
 */
export function eligibleSuccessors(members: LeagueMember[], leavingUserId: string): LeagueMember[] {
  const seen = new Set<string>();
  return members
    .filter((m) => !!m.clerkUserId && !m.leftAt && m.clerkUserId !== leavingUserId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.playerId - b.playerId)
    .filter((m) => {
      if (seen.has(m.clerkUserId!)) return false;
      seen.add(m.clerkUserId!);
      return true;
    });
}

/**
 * The new admin: the member the person picked, if they can take over, else
 * the longest-standing member. Null when nobody can.
 */
export function pickSuccessor(
  members: LeagueMember[],
  leavingUserId: string,
  chosenPlayerId?: number | null,
): LeagueMember | null {
  const eligible = eligibleSuccessors(members, leavingUserId);
  return eligible.find((m) => m.playerId === chosenPlayerId) ?? eligible[0] ?? null;
}

/**
 * Reads `newAdmins: [{ leagueId, playerId }]` from the Delete account request
 * into { leagueId: playerId }. Anything malformed is dropped: a bad pick falls
 * back to the longest-standing member rather than stopping the deletion.
 */
export function parseNewAdmins(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const leagueId = Number((item as { leagueId?: unknown } | null)?.leagueId);
    const playerId = Number((item as { playerId?: unknown } | null)?.playerId);
    if (Number.isInteger(leagueId) && Number.isInteger(playerId)) out[leagueId] = playerId;
  }
  return out;
}

export interface SoleAdminLeague {
  leagueId: number;
  name: string;
  role: LeagueRole;
  endedAt: Date | null;
}

/**
 * Leagues this person runs with no other admin. Includes leagues made before
 * co-admins, where the creator with no admin rows is the owner.
 */
export async function leaguesRunAlone(q: Reader, clerkUserId: string): Promise<SoleAdminLeague[]> {
  const mine = await q
    .select({ leagueId: leagueAdminsTable.leagueId, role: leagueAdminsTable.role })
    .from(leagueAdminsTable)
    .where(eq(leagueAdminsTable.clerkUserId, clerkUserId));
  const created = await q
    .select({ id: leaguesTable.id })
    .from(leaguesTable)
    .where(eq(leaguesTable.createdByClerkUserId, clerkUserId));
  const ids = [...new Set([...mine.map((m) => m.leagueId), ...created.map((c) => c.id)])];
  if (!ids.length) return [];

  const admins = await q
    .select({ leagueId: leagueAdminsTable.leagueId, clerkUserId: leagueAdminsTable.clerkUserId })
    .from(leagueAdminsTable)
    .where(inArray(leagueAdminsTable.leagueId, ids));
  const leagues = await q
    .select({ id: leaguesTable.id, name: leaguesTable.name, endedAt: leaguesTable.endedAt })
    .from(leaguesTable)
    .where(inArray(leaguesTable.id, ids));

  const out: SoleAdminLeague[] = [];
  for (const league of leagues) {
    const others = admins.some((a) => a.leagueId === league.id && a.clerkUserId !== clerkUserId);
    if (others) continue;
    const role = mine.find((m) => m.leagueId === league.id)?.role ?? "owner";
    out.push({ leagueId: league.id, name: league.name, role, endedAt: league.endedAt ?? null });
  }
  return out.sort((a, b) => a.leagueId - b.leagueId);
}

/** Who could take over each league, longest-standing first. */
export async function successorsByLeague(
  q: Reader,
  leagueIds: number[],
  leavingUserId: string,
): Promise<Map<number, LeagueMember[]>> {
  const out = new Map<number, LeagueMember[]>();
  if (!leagueIds.length) return out;
  const rows = await q
    .select({
      playerId: playersTable.id,
      leagueId: playersTable.leagueId,
      clerkUserId: playersTable.clerkUserId,
      name: playersTable.name,
      leftAt: playersTable.leftAt,
      createdAt: playersTable.createdAt,
    })
    .from(playersTable)
    .where(inArray(playersTable.leagueId, leagueIds));
  for (const id of leagueIds) {
    const members = rows
      .filter((r) => r.leagueId === id)
      .map((r) => ({
        playerId: r.playerId,
        clerkUserId: r.clerkUserId,
        name: r.name,
        leftAt: r.leftAt ?? null,
        createdAt: new Date(r.createdAt),
      }));
    out.set(id, eligibleSuccessors(members, leavingUserId));
  }
  return out;
}

export interface Promotion {
  leagueId: number;
  playerId: number;
  clerkUserId: string;
  role: LeagueRole;
}

/**
 * `newAdmins` maps a league ID to the player the person picked to run it.
 * Returns who was made admin where.
 */
export async function deleteLeagueDataFor(
  tx: Tx,
  clerkUserId: string,
  newAdmins: Record<number, number> = {},
): Promise<Promotion[]> {
  const promotions: Promotion[] = [];
  const alone = await leaguesRunAlone(tx, clerkUserId);
  if (alone.length) {
    const successors = await successorsByLeague(tx, alone.map((l) => l.leagueId), clerkUserId);
    for (const league of alone) {
      const next = pickSuccessor(successors.get(league.leagueId) ?? [], clerkUserId, newAdmins[league.leagueId]);
      if (!next?.clerkUserId) continue;
      await tx
        .insert(leagueAdminsTable)
        .values({ leagueId: league.leagueId, clerkUserId: next.clerkUserId, role: league.role })
        .onConflictDoNothing();
      promotions.push({ leagueId: league.leagueId, playerId: next.playerId, clerkUserId: next.clerkUserId, role: league.role });
    }
  }

  await tx.delete(leagueAdminsTable).where(eq(leagueAdminsTable.clerkUserId, clerkUserId));
  await tx.delete(leagueJoinRequestsTable).where(eq(leagueJoinRequestsTable.clerkUserId, clerkUserId));
  await tx.update(leaguesTable).set({ createdByClerkUserId: null }).where(eq(leaguesTable.createdByClerkUserId, clerkUserId));
  return promotions;
}
