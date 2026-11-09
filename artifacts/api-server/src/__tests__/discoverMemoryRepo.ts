// An in-memory Discover repository for route tests (no database).

import type { FreeRange } from "@workspace/free-times";
import type { Area } from "../lib/discoverArea";
import type { OpenLeagueCandidate } from "../lib/discoverLeagues";
import type { DiscoverCandidate } from "../lib/discoverPlayers";
import type { DiscoverMe, DiscoverRepo } from "../lib/discoverRepo";

export class MemoryDiscoverRepo implements DiscoverRepo {
  leagues: (OpenLeagueCandidate & { member: boolean })[] = [];
  mes = new Map<string, DiscoverMe>();
  people: DiscoverCandidate[] = [];
  reports: unknown[] = [];
  blocks: [string, string][] = [];
  accounts = new Map<number, string>();

  async me(id: string) {
    return this.mes.get(id) ?? null;
  }
  async near() {
    return this.people;
  }
  async person(_viewer: string, userId: number) {
    return this.people.find((p) => p.userId === userId) ?? null;
  }
  async reliability(ids: string[]) {
    return new Map(ids.map((id) => [id, { played: 3, noShows: 0, wins: 2, losses: 1 }]));
  }
  async saveSettings(id: string, input: { hidden?: boolean; plays?: string | null; radius?: number; matchAlerts?: boolean }) {
    const m = this.mes.get(id)!;
    this.mes.set(id, { ...m, ...("hidden" in input ? { hidden: input.hidden! } : {}), ...(input.plays !== undefined ? { plays: input.plays } : {}), ...(input.radius ? { radius: input.radius } : {}), ...(input.matchAlerts !== undefined ? { matchAlerts: input.matchAlerts } : {}) });
  }
  async setArea(id: string, area: Area) {
    const m = this.mes.get(id)!;
    this.mes.set(id, { ...m, area, homeZip: area.zip });
  }
  async saveSlots(id: string, slots: number[]) {
    const m = this.mes.get(id)!;
    this.mes.set(id, { ...m, slots, freeTimes: null });
  }
  async saveFreeTimes(id: string, freeTimes: FreeRange[]) {
    const m = this.mes.get(id)!;
    this.mes.set(id, { ...m, freeTimes });
  }
  async accountForUser(userId: number) {
    return this.accounts.get(userId) ?? null;
  }
  async fileReport(input: unknown) {
    this.reports.push(input);
    return this.reports.length;
  }
  async block(a: string, b: string) {
    this.blocks.push([a, b]);
  }
  async unblock(a: string, b: string) {
    this.blocks = this.blocks.filter(([x, y]) => !(x === a && y === b));
  }
  async openLeagues() {
    return this.leagues.filter((l) => !l.member);
  }
  async openLeague(_viewer: string, leagueId: number) {
    return this.leagues.find((l) => l.leagueId === leagueId) ?? null;
  }
}
