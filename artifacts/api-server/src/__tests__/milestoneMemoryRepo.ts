import type { CareerData } from "../lib/careerRepo";
import type { MilestoneRepo, StoredMilestone } from "../lib/milestoneRepo";
import type { EarnedMilestone, MilestoneKind, MilestoneRecording } from "../lib/milestones";

/** Milestones in memory, for tests: no database. */
export class MemoryMilestones implements MilestoneRepo {
  rows = new Map<string, (StoredMilestone & { matchId: number | null })[]>();
  career = new Map<string, CareerData>();
  recordings = new Map<string, MilestoneRecording[]>();
  matchAccounts = new Map<number, string[]>();
  inserts = 0;

  async inputs(clerkUserId: string) {
    const empty: CareerData = { matches: [], players: new Map(), users: new Map(), leagues: new Map(), seasons: [] };
    return { career: this.career.get(clerkUserId) ?? empty, recordings: this.recordings.get(clerkUserId) ?? [] };
  }
  async stored(clerkUserId: string) {
    return (this.rows.get(clerkUserId) ?? []).map(({ kind, earnedAt, seenAt }) => ({ kind, earnedAt, seenAt }));
  }
  async insert(clerkUserId: string, earned: EarnedMilestone[], seen: boolean) {
    const have = this.rows.get(clerkUserId) ?? [];
    const added = earned.filter((e) => !have.some((h) => h.kind === e.kind));
    this.inserts += added.length;
    this.rows.set(clerkUserId, [
      ...have,
      ...added.map((e) => ({ kind: e.kind, earnedAt: new Date(e.earnedAt), seenAt: seen ? new Date("2026-11-08T00:00:00Z") : null, matchId: e.matchId })),
    ]);
    return added;
  }
  async markSeen(clerkUserId: string, kinds: MilestoneKind[], at: Date) {
    for (const r of this.rows.get(clerkUserId) ?? []) if (kinds.includes(r.kind) && !r.seenAt) r.seenAt = at;
  }
  async accountsInMatch(matchId: number) {
    return this.matchAccounts.get(matchId) ?? [];
  }
  async allAccounts() {
    return [...new Set([...this.career.keys(), ...this.recordings.keys()])];
  }
}
