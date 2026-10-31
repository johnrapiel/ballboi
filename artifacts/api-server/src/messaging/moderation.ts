// Auto-restrict and moderation records. Spec: Messaging and moderation,
// Enforcement ladder steps 1 and 2:
//   "accounts flagged by AI moderation or reported by 2 or more different
//    people drop to zero new conversations and pending requests are hidden,
//    instantly, until reviewed."
// Behavior signals (spec step 1): many unanswered first messages, repeated
// blocks, copy-paste openers. The thresholds live in RESTRICT_RULES so they're
// easy to tune.

import type { ReportReason, ReportSource, ReportTargetType, RestrictionSource, SnapshotMessage } from "@workspace/db";

export const RESTRICT_RULES = {
  /** Distinct people with an open or upheld report against the account. */
  reporters: 2,
  /** Distinct people who blocked the account within blockWindowDays. */
  blockers: 3,
  blockWindowDays: 30,
  /** First messages still unanswered after unansweredAfterHours, counted over unansweredWindowDays. */
  unansweredRequests: 5,
  unansweredAfterHours: 48,
  unansweredWindowDays: 14,
  /** The same first message sent to this many different people within 24 hours. */
  sameOpener: 3,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
  distinctReportersAgainst(subject: string): Promise<number>;
  distinctBlockersSince(subject: string, since: Date): Promise<number>;
  unansweredRequests(subject: string, createdBefore: Date, createdAfter: Date): Promise<number>;
  /** Conversations this person started with this opener since a time. */
  sameOpenerSince(subject: string, openingHash: string, since: Date): Promise<number>;
  activeRestriction(subject: string): Promise<Restriction | null>;
  restrict(input: { subject: string; reason: string; source: RestrictionSource; reportId: number | null }): Promise<Restriction>;
  /** Returns false when there was nothing to lift. */
  lift(subject: string, by: string): Promise<boolean>;
  restrictedSet(subjects: string[]): Promise<Set<string>>;
}

export type RestrictTrigger =
  | { kind: "report" }
  | { kind: "block" }
  | { kind: "request"; openingHash: string }
  | { kind: "flag"; details: string; reason: ReportReason };

export class AutoRestrict {
  constructor(
    private repo: ModerationRepo,
    private now: () => Date = () => new Date(),
    private onRestricted?: (r: Restriction) => void,
  ) {}

  /**
   * Checks the rules that apply to this trigger. Restricts the account and
   * files an "account" report for review the first time one fires. Returns
   * true when the account is restricted afterwards.
   */
  async evaluate(subject: string, trigger: RestrictTrigger): Promise<boolean> {
    if (await this.repo.activeRestriction(subject)) return true;
    const reason = await this.firstRuleHit(subject, trigger);
    if (!reason) return false;
    const reportId = await this.repo.createReport({
      reporter: null,
      targetType: "account",
      targetId: subject,
      reason: trigger.kind === "flag" ? trigger.reason : trigger.kind === "report" ? "harassment" : "spam",
      details: reason,
      source: trigger.kind === "flag" ? "stream" : "auto",
      subject,
    });
    const restriction = await this.repo.restrict({ subject, reason, source: trigger.kind === "flag" ? "stream" : "auto", reportId });
    this.onRestricted?.(restriction);
    return true;
  }

  private async firstRuleHit(subject: string, trigger: RestrictTrigger): Promise<string | null> {
    const now = this.now().getTime();
    switch (trigger.kind) {
      case "flag":
        return `Flagged by Stream moderation: ${trigger.details}`;
      case "report": {
        const n = await this.repo.distinctReportersAgainst(subject);
        return n >= RESTRICT_RULES.reporters ? `Reported by ${n} different people` : null;
      }
      case "block": {
        const n = await this.repo.distinctBlockersSince(subject, new Date(now - RESTRICT_RULES.blockWindowDays * DAY));
        return n >= RESTRICT_RULES.blockers ? `Blocked by ${n} people in ${RESTRICT_RULES.blockWindowDays} days` : null;
      }
      case "request": {
        // This send would be the Nth identical opener.
        const same = (await this.repo.sameOpenerSince(subject, trigger.openingHash, new Date(now - DAY))) + 1;
        if (same >= RESTRICT_RULES.sameOpener) return `Sent the same first message to ${same} people in a day`;
        const unanswered = await this.repo.unansweredRequests(
          subject,
          new Date(now - RESTRICT_RULES.unansweredAfterHours * HOUR),
          new Date(now - RESTRICT_RULES.unansweredWindowDays * DAY),
        );
        return unanswered >= RESTRICT_RULES.unansweredRequests ? `${unanswered} first messages with no reply` : null;
      }
    }
  }
}

/** In-memory ModerationRepo for tests. */
export class MemoryModerationRepo implements ModerationRepo {
  reports: (NewReport & { id: number; status: string; createdAt: Date })[] = [];
  restrictions: Restriction[] = [];
  blocks: { blocker: string; blocked: string; at: Date }[] = [];
  /** Conversations started by people, for opener and unanswered checks. */
  started: { requester: string; openingHash: string; status: string; createdAt: Date }[] = [];
  /** Tests can point this at a MemoryMessagingRepo's conversations. */
  startedFrom: () => { requester: string; openingHash: string; status: string; createdAt: Date }[] = () => this.started;
  private nextId = 1;

  constructor(private now: () => Date = () => new Date()) {}

  async createReport(report: NewReport) {
    const id = this.nextId++;
    this.reports.push({ ...report, id, status: "open", createdAt: this.now() });
    return id;
  }
  async distinctReportersAgainst(subject: string) {
    return new Set(this.reports.filter((r) => r.subject === subject && r.reporter && r.status !== "dismissed").map((r) => r.reporter)).size;
  }
  async distinctBlockersSince(subject: string, since: Date) {
    return new Set(this.blocks.filter((b) => b.blocked === subject && b.at >= since).map((b) => b.blocker)).size;
  }
  async unansweredRequests(subject: string, createdBefore: Date, createdAfter: Date) {
    return this.startedFrom().filter(
      (c) => c.requester === subject && c.status !== "active" && c.createdAt <= createdBefore && c.createdAt >= createdAfter,
    ).length;
  }
  async sameOpenerSince(subject: string, openingHash: string, since: Date) {
    return this.startedFrom().filter((c) => c.requester === subject && c.openingHash === openingHash && c.createdAt >= since).length;
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
