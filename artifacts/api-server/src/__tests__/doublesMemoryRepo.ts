// An in-memory doubles partners repository for service and route tests (no database).

import type { DoublesPartnersRepo, Member, PartnersLeague } from "../lib/doublesPartnersRepo";
import type { PartnerRequest, TeamRow } from "../lib/doublesTeams";
import { pairKey } from "../lib/pairing";

export class MemoryDoublesRepo implements DoublesPartnersRepo {
  leagues: PartnersLeague[] = [];
  people: (Member & { leagueId: number })[] = [];
  teamRows: (TeamRow & { leagueId: number; madeBy: string })[] = [];
  requestRows: PartnerRequest[] = [];
  blocks = new Set<string>();
  adminIds = new Map<number, string[]>();
  published = new Set<number>();
  /** Unplayed matches per team id, and the accounts in each. */
  teamMatches = new Map<number, string[]>();
  dropped: number[] = [];
  private nextId = 1;

  async league(id: number) {
    return this.leagues.find((l) => l.id === id) ?? null;
  }
  async firstRoundOut(id: number) {
    return this.published.has(id);
  }
  async members(leagueId: number) {
    return this.people.filter((p) => p.leagueId === leagueId).map((p) => ({ ...p }));
  }
  async teams(leagueId: number) {
    return this.teamRows.filter((t) => t.leagueId === leagueId).map((t) => ({ ...t }));
  }
  async requests(leagueId: number) {
    return this.requestRows.filter((r) => r.leagueId === leagueId).map((r) => ({ ...r }));
  }
  async pendingBefore(before: Date) {
    return this.requestRows.filter((r) => r.status === "pending" && r.createdAt < before).map((r) => ({ ...r }));
  }
  async blockedPairs(ids: number[]) {
    const out = new Set<string>();
    for (const a of ids) for (const b of ids) if (a < b && this.blocks.has(pairKey(a, b))) out.add(pairKey(a, b));
    return out;
  }
  async admins(leagueId: number) {
    return this.adminIds.get(leagueId) ?? [];
  }
  async createTeam(leagueId: number, a: number, b: number, madeBy: "request" | "admin" | "auto") {
    const t = { id: this.nextId++, leagueId, player1Id: a, player2Id: b, madeBy, dissolvedAt: null, dissolvedReason: null };
    this.teamRows.push(t);
    return { ...t };
  }
  async dissolveTeam(id: number, reason: "split" | "partner_left", at: Date) {
    const t = this.teamRows.find((x) => x.id === id && !x.dissolvedAt);
    if (!t) return false;
    t.dissolvedAt = at;
    t.dissolvedReason = reason;
    return true;
  }
  async createRequest(leagueId: number, from: number, to: number, at: Date) {
    const r: PartnerRequest = { id: this.nextId++, leagueId, fromPlayerId: from, toPlayerId: to, status: "pending", createdAt: at, respondedAt: null, noticeSeenAt: null };
    this.requestRows.push(r);
    return { ...r };
  }
  async settleRequest(id: number, status: "accepted" | "declined" | "expired" | "cancelled" | "taken", at: Date) {
    const r = this.requestRows.find((x) => x.id === id && x.status === "pending");
    if (!r) return false;
    r.status = status;
    r.respondedAt = at;
    return true;
  }
  async noticeSeen(id: number, at: Date) {
    const r = this.requestRows.find((x) => x.id === id);
    if (r) r.noticeSeenAt = at;
  }
  async setLooking(ids: number[], at: Date | null) {
    for (const p of this.people) if (ids.includes(p.id)) p.lookingForPartnerAt = at;
  }
  async dropTeamMatches(teamId: number) {
    this.dropped.push(teamId);
    return this.teamMatches.get(teamId) ?? [];
  }
}
