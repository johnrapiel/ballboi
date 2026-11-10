// Storage for doubles partners (D2, D4, D9). The service talks to this
// interface, so tests run on an in-memory copy (__tests__/doublesMemoryRepo.ts).

import {
  db,
  leagueAdminsTable,
  leaguePartnerRequestsTable,
  leagueRoundsTable,
  leagueTeamsTable,
  leaguesTable,
  matchesTable,
  playersTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { blockedPlayerPairs } from "./blocks.js";
import { loadProfiles, playerDisplayName, playerLevelValue } from "./playerProfile.js";
import type { MemberRow, PartnerRequest, TeamRow } from "./doublesTeams.js";

export interface PartnersLeague {
  id: number;
  name: string;
  leagueType: string;
  partnerMode: string | null;
  visibility: string;
  endedAt: Date | null;
}

export interface Member extends MemberRow {
  clerkUserId: string | null;
}

export interface DoublesPartnersRepo {
  league(leagueId: number): Promise<PartnersLeague | null>;
  /** Any round in this league has gone out to players. */
  firstRoundOut(leagueId: number): Promise<boolean>;
  /** Players still in the league, with profile names and levels. */
  members(leagueId: number): Promise<Member[]>;
  /** Every team, split ones included. */
  teams(leagueId: number): Promise<TeamRow[]>;
  requests(leagueId: number): Promise<PartnerRequest[]>;
  /** Pending requests anywhere created before `before`. */
  pendingBefore(before: Date): Promise<PartnerRequest[]>;
  blockedPairs(playerIds: number[]): Promise<Set<string>>;
  admins(leagueId: number): Promise<string[]>;
  createTeam(leagueId: number, a: number, b: number, madeBy: "request" | "admin" | "auto", at: Date): Promise<TeamRow>;
  dissolveTeam(teamId: number, reason: "split" | "partner_left", at: Date): Promise<boolean>;
  createRequest(leagueId: number, from: number, to: number, at: Date): Promise<PartnerRequest>;
  /** Moves a pending request on. False when it wasn't pending any more. */
  settleRequest(id: number, status: "accepted" | "declined" | "expired" | "cancelled" | "taken", at: Date): Promise<boolean>;
  noticeSeen(id: number, at: Date): Promise<void>;
  setLooking(playerIds: number[], at: Date | null): Promise<void>;
  /**
   * After a split: the team's unplayed matches. Drafts lose them (the round
   * pairs again when it goes out); rounds already out void them. Returns the
   * accounts in the voided matches, to tell them.
   */
  dropTeamMatches(teamId: number, at: Date): Promise<string[]>;
}

export class DrizzleDoublesPartnersRepo implements DoublesPartnersRepo {
  async league(leagueId: number): Promise<PartnersLeague | null> {
    const [l] = await db
      .select({
        id: leaguesTable.id,
        name: leaguesTable.name,
        leagueType: leaguesTable.leagueType,
        partnerMode: leaguesTable.partnerMode,
        visibility: leaguesTable.visibility,
        endedAt: leaguesTable.endedAt,
      })
      .from(leaguesTable)
      .where(eq(leaguesTable.id, leagueId));
    return l ?? null;
  }

  async firstRoundOut(leagueId: number): Promise<boolean> {
    const rows = await db
      .select({ id: leagueRoundsTable.id })
      .from(leagueRoundsTable)
      .where(and(eq(leagueRoundsTable.leagueId, leagueId), isNotNull(leagueRoundsTable.publishedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async members(leagueId: number): Promise<Member[]> {
    const rows = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.leagueId, leagueId), isNull(playersTable.leftAt)));
    const profiles = await loadProfiles(rows.map((r) => r.clerkUserId));
    return rows.map((r) => ({
      id: r.id,
      name: playerDisplayName(r, profiles),
      level: playerLevelValue(r, profiles),
      lookingForPartnerAt: r.lookingForPartnerAt ?? null,
      clerkUserId: r.clerkUserId,
    }));
  }

  async teams(leagueId: number): Promise<TeamRow[]> {
    return db
      .select({
        id: leagueTeamsTable.id,
        player1Id: leagueTeamsTable.player1Id,
        player2Id: leagueTeamsTable.player2Id,
        dissolvedAt: leagueTeamsTable.dissolvedAt,
        dissolvedReason: leagueTeamsTable.dissolvedReason,
      })
      .from(leagueTeamsTable)
      .where(eq(leagueTeamsTable.leagueId, leagueId));
  }

  async requests(leagueId: number): Promise<PartnerRequest[]> {
    return db.select().from(leaguePartnerRequestsTable).where(eq(leaguePartnerRequestsTable.leagueId, leagueId));
  }

  async pendingBefore(before: Date): Promise<PartnerRequest[]> {
    const rows = await db.select().from(leaguePartnerRequestsTable).where(eq(leaguePartnerRequestsTable.status, "pending"));
    return rows.filter((r) => r.createdAt < before);
  }

  blockedPairs(playerIds: number[]): Promise<Set<string>> {
    return blockedPlayerPairs(playerIds);
  }

  async admins(leagueId: number): Promise<string[]> {
    const rows = await db
      .select({ clerkUserId: leagueAdminsTable.clerkUserId })
      .from(leagueAdminsTable)
      .where(eq(leagueAdminsTable.leagueId, leagueId));
    return rows.map((r) => r.clerkUserId);
  }

  async createTeam(leagueId: number, a: number, b: number, madeBy: "request" | "admin" | "auto", at: Date): Promise<TeamRow> {
    const [row] = await db
      .insert(leagueTeamsTable)
      .values({ leagueId, player1Id: a, player2Id: b, madeBy, createdAt: at })
      .returning();
    return { id: row.id, player1Id: row.player1Id, player2Id: row.player2Id, dissolvedAt: null, dissolvedReason: null };
  }

  async dissolveTeam(teamId: number, reason: "split" | "partner_left", at: Date): Promise<boolean> {
    const rows = await db
      .update(leagueTeamsTable)
      .set({ dissolvedAt: at, dissolvedReason: reason })
      .where(and(eq(leagueTeamsTable.id, teamId), isNull(leagueTeamsTable.dissolvedAt)))
      .returning({ id: leagueTeamsTable.id });
    return rows.length > 0;
  }

  async createRequest(leagueId: number, from: number, to: number, at: Date): Promise<PartnerRequest> {
    const [row] = await db
      .insert(leaguePartnerRequestsTable)
      .values({ leagueId, fromPlayerId: from, toPlayerId: to, status: "pending", createdAt: at })
      .returning();
    return row;
  }

  async settleRequest(id: number, status: "accepted" | "declined" | "expired" | "cancelled" | "taken", at: Date): Promise<boolean> {
    const rows = await db
      .update(leaguePartnerRequestsTable)
      .set({ status, respondedAt: at })
      .where(and(eq(leaguePartnerRequestsTable.id, id), eq(leaguePartnerRequestsTable.status, "pending")))
      .returning({ id: leaguePartnerRequestsTable.id });
    return rows.length > 0;
  }

  async noticeSeen(id: number, at: Date): Promise<void> {
    await db.update(leaguePartnerRequestsTable).set({ noticeSeenAt: at }).where(eq(leaguePartnerRequestsTable.id, id));
  }

  async setLooking(playerIds: number[], at: Date | null): Promise<void> {
    if (!playerIds.length) return;
    await db.update(playersTable).set({ lookingForPartnerAt: at }).where(inArray(playersTable.id, playerIds));
  }

  async dropTeamMatches(teamId: number, at: Date): Promise<string[]> {
    const rows = await db
      .select({
        id: matchesTable.id,
        roundId: matchesTable.roundId,
        p1: matchesTable.player1Id,
        p2: matchesTable.player2Id,
        p3: matchesTable.player3Id,
        p4: matchesTable.player4Id,
      })
      .from(matchesTable)
      .where(and(
        or(eq(matchesTable.team1Id, teamId), eq(matchesTable.team2Id, teamId)),
        ne(matchesTable.status, "completed"),
        isNull(matchesTable.voidedAt),
      ));
    if (!rows.length) return [];
    const roundIds = [...new Set(rows.map((r) => r.roundId).filter((id): id is number => id != null))];
    const rounds = roundIds.length
      ? await db.select({ id: leagueRoundsTable.id, publishedAt: leagueRoundsTable.publishedAt }).from(leagueRoundsTable).where(inArray(leagueRoundsTable.id, roundIds))
      : [];
    const draft = new Set(rounds.filter((r) => !r.publishedAt).map((r) => r.id));
    const drafts = rows.filter((r) => r.roundId != null && draft.has(r.roundId)).map((r) => r.id);
    const out = rows.filter((r) => !drafts.includes(r.id));
    if (drafts.length) await db.delete(matchesTable).where(inArray(matchesTable.id, drafts));
    if (out.length) await db.update(matchesTable).set({ voidedAt: at, status: "voided" }).where(inArray(matchesTable.id, out.map((r) => r.id)));
    const ids = [...new Set(out.flatMap((r) => [r.p1, r.p2, r.p3, r.p4]).filter((id): id is number => id != null))];
    if (!ids.length) return [];
    const accounts = await db.select({ clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, ids));
    return accounts.map((a) => a.clerkUserId).filter((id): id is string => !!id);
  }
}
