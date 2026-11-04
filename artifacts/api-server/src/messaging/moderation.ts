// Moderation records: reports and messaging restrictions. Spec: Messaging and
// moderation, Enforcement ladder.
//
// Nothing restricts an account automatically (John's decision, Nov 4 2026).
// Player reports and Stream moderation flags land in the review queue, and the
// account is untouched until a moderator acts: John, or the Claude agent after
// 6 hours (agent.ts). Restrictions come only from those two.

import type { ReportReason, ReportSource, ReportTargetType, RestrictionSource, SnapshotMessage } from "@workspace/db";

export interface NewReport {
  reporter: string | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  source: ReportSource;
  subject: string | null;
  snapshot?: { conversationId: number; messages: SnapshotMessage[] };
}

export interface Restriction {
  id: number;
  clerkUserId: string;
  reason: string;
  source: RestrictionSource;
  reportId: number | null;
  createdAt: Date;
  liftedAt: Date | null;
}

export interface ModerationRepo {
  createReport(report: NewReport): Promise<number>;
  activeRestriction(subject: string): Promise<Restriction | null>;
  restrict(input: { subject: string; reason: string; source: RestrictionSource; reportId: number | null }): Promise<Restriction>;
  /** Returns false when there was nothing to lift. */
  lift(subject: string, by: string): Promise<boolean>;
  restrictedSet(subjects: string[]): Promise<Set<string>>;
}

/** In-memory ModerationRepo for tests. */
export class MemoryModerationRepo implements ModerationRepo {
  reports: (NewReport & { id: number; status: string; createdAt: Date })[] = [];
  restrictions: Restriction[] = [];
  private nextId = 1;

  constructor(private now: () => Date = () => new Date()) {}

  async createReport(report: NewReport) {
    const id = this.nextId++;
    this.reports.push({ ...report, id, status: "open", createdAt: this.now() });
    return id;
  }
  async activeRestriction(subject: string) {
    return this.restrictions.find((r) => r.clerkUserId === subject && !r.liftedAt) ?? null;
  }
  async restrict(input: { subject: string; reason: string; source: RestrictionSource; reportId: number | null }) {
    const existing = await this.activeRestriction(input.subject);
    if (existing) return existing;
    const r: Restriction = {
      id: this.nextId++,
      clerkUserId: input.subject,
      reason: input.reason,
      source: input.source,
      reportId: input.reportId,
      createdAt: this.now(),
      liftedAt: null,
    };
    this.restrictions.push(r);
    return r;
  }
  async lift(subject: string) {
    const r = await this.activeRestriction(subject);
    if (!r) return false;
    r.liftedAt = this.now();
    return true;
  }
  async restrictedSet(subjects: string[]) {
    return new Set(subjects.filter((s) => this.restrictions.some((r) => r.clerkUserId === s && !r.liftedAt)));
  }
}
