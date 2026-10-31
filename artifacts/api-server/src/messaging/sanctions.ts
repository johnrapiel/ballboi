// Bans, suspensions and one appeal. Spec: Messaging and moderation,
// Enforcement ladder:
//   4. "suspensions and bans are human-only"
//   5. "Ban sticks: blocks the Apple ID, email, and device" (device = DeviceCheck, Wave 2)
//   6. "One appeal: by email"
// Checklist 3a: "Bans stick", "One appeal by email: route to support address,
// log outcome in the reports view".
//
// Only moderators create sanctions (routes/moderation.ts, behind requireAdmin).
// The Claude agent and auto-restrict can't: they only restrict messaging.

import type { AccountSanction, AppealOutcome, SanctionAppeal, SanctionKind } from "@workspace/db";

export const SUPPORT_EMAIL = "support@ballboi.tennis";
export const MAX_SUSPEND_DAYS = 90;
const DAY = 86_400_000;

/** Who someone is at sign-in, as far as bans are concerned. */
export interface AccountIdentity {
  clerkUserId: string;
  appleUserId: string | null;
  /** Lowercased. */
  emails: string[];
}

export class SanctionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface NewSanction {
  kind: SanctionKind;
  clerkUserId: string;
  appleUserId: string | null;
  emails: string[];
  reason: string;
  reportId: number | null;
  endsAt: Date | null;
  createdBy: string;
}

export interface SanctionsRepo {
  /** Sanctions not lifted and not past their end, matching any of the identity's keys. */
  activeFor(identity: AccountIdentity, now: Date): Promise<AccountSanction[]>;
  /** True when no sanction anywhere is active: lets the sign-in check skip the identity lookup. */
  noneActive(now: Date): Promise<boolean>;
  create(input: NewSanction): Promise<AccountSanction>;
  get(id: number): Promise<AccountSanction | null>;
  lift(id: number, by: string, at: Date): Promise<AccountSanction | null>;
  list(opts: { active: boolean; now: Date }): Promise<AccountSanction[]>;
  appealFor(sanctionId: number): Promise<SanctionAppeal | null>;
  /** Returns null when this sanction already has an appeal. */
  createAppeal(input: { sanctionId: number; clerkUserId: string; reportId: number | null }): Promise<SanctionAppeal | null>;
  getAppeal(id: number): Promise<SanctionAppeal | null>;
  listAppeals(opts: { open: boolean }): Promise<SanctionAppeal[]>;
  decideAppeal(id: number, input: { outcome: AppealOutcome; note: string | null; by: string; at: Date }): Promise<SanctionAppeal>;
}

/** Files the appeal into the one reports queue (/api/admin/reports). */
export type LogAppealReport = (input: { clerkUserId: string; sanction: AccountSanction }) => Promise<number | null>;

/** What the app shows at sign-in. The moderator's reason stays private. */
export interface AccountStatus {
  status: "ok" | "banned" | "suspended";
  /** Suspensions only. */
  endsAt: string | null;
  appeal: { submittedAt: string; outcome: AppealOutcome | null } | null;
  canAppeal: boolean;
  supportEmail: string;
  /** Put in the appeal email's subject so the moderator can find it. */
  appealReference: string | null;
}

export function normalizeEmails(emails: (string | null | undefined)[]): string[] {
  return [...new Set(emails.filter((e): e is string => typeof e === "string" && e.includes("@")).map((e) => e.trim().toLowerCase()))];
}

export function appealReference(sanctionId: number): string {
  return `BB-${String(sanctionId).padStart(5, "0")}`;
}

/** Bans outrank suspensions; between suspensions, the one that ends last. */
function strongest(list: AccountSanction[]): AccountSanction | null {
  if (!list.length) return null;
  const ban = list.find((s) => s.kind === "ban");
  if (ban) return ban;
  return [...list].sort((a, b) => (b.endsAt?.getTime() ?? 0) - (a.endsAt?.getTime() ?? 0))[0];
}

export class SanctionsService {
  constructor(
    private repo: SanctionsRepo,
    private logAppealReport: LogAppealReport,
    private now: () => Date = () => new Date(),
  ) {}

  /** The sanction that applies to this person right now, if any. */
  async current(identity: AccountIdentity): Promise<AccountSanction | null> {
    return strongest(await this.repo.activeFor(identity, this.now()));
  }

  async noneActive(): Promise<boolean> {
    return this.repo.noneActive(this.now());
  }

  async status(identity: AccountIdentity): Promise<AccountStatus> {
    const s = await this.current(identity);
    if (!s) {
      return { status: "ok", endsAt: null, appeal: null, canAppeal: false, supportEmail: SUPPORT_EMAIL, appealReference: null };
    }
    const appeal = await this.repo.appealFor(s.id);
    return {
      status: s.kind === "ban" ? "banned" : "suspended",
      endsAt: s.endsAt?.toISOString() ?? null,
      appeal: appeal ? { submittedAt: appeal.createdAt.toISOString(), outcome: (appeal.outcome as AppealOutcome | null) ?? null } : null,
      canAppeal: !appeal,
      supportEmail: SUPPORT_EMAIL,
      appealReference: appealReference(s.id),
    };
  }

  /**
   * Bans or suspends an account. The identity is read from Clerk at this
   * moment, so a later account with the same Apple ID or email is caught too.
   */
  async sanction(input: {
    kind: SanctionKind;
    identity: AccountIdentity;
    reason: unknown;
    reportId: unknown;
    days?: unknown;
    by: string;
  }): Promise<AccountSanction> {
    const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    if (!reason) throw new SanctionError(400, "reason_required", "Add a reason for the record.");
    let endsAt: Date | null = null;
    if (input.kind === "suspend") {
      const days = Number(input.days);
      if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPEND_DAYS) {
        throw new SanctionError(400, "invalid_days", `Suspensions last 1 to ${MAX_SUSPEND_DAYS} days.`);
      }
      endsAt = new Date(this.now().getTime() + days * DAY);
    }
    return this.repo.create({
      kind: input.kind,
      clerkUserId: input.identity.clerkUserId,
      appleUserId: input.identity.appleUserId,
      emails: normalizeEmails(input.identity.emails),
      reason,
      reportId: Number.isInteger(input.reportId) ? (input.reportId as number) : null,
      endsAt,
      createdBy: input.by,
    });
  }

  async lift(id: number, by: string): Promise<AccountSanction> {
    const s = await this.repo.get(id);
    if (!s) throw new SanctionError(404, "not_found", "Sanction not found.");
    if (s.liftedAt) throw new SanctionError(409, "already_lifted", "This was already lifted.");
    const lifted = await this.repo.lift(id, by, this.now());
    if (!lifted) throw new SanctionError(409, "already_lifted", "This was already lifted.");
    return lifted;
  }

  /** The person's one appeal against what's blocking them now. */
  async appeal(identity: AccountIdentity): Promise<{ reference: string; supportEmail: string }> {
    const s = await this.current(identity);
    if (!s) throw new SanctionError(400, "not_sanctioned", "Your account isn't banned or suspended.");
    if (await this.repo.appealFor(s.id)) throw new SanctionError(409, "already_appealed", "You've already appealed. We'll reply by email.");
    const reportId = await this.logAppealReport({ clerkUserId: identity.clerkUserId, sanction: s });
    const created = await this.repo.createAppeal({ sanctionId: s.id, clerkUserId: identity.clerkUserId, reportId });
    if (!created) throw new SanctionError(409, "already_appealed", "You've already appealed. We'll reply by email.");
    return { reference: appealReference(s.id), supportEmail: SUPPORT_EMAIL };
  }

  /** John's decision. Overturning lifts the sanction. Each appeal is decided once. */
  async decideAppeal(id: number, input: { outcome: unknown; note: unknown; by: string }): Promise<SanctionAppeal> {
    const appeal = await this.repo.getAppeal(id);
    if (!appeal) throw new SanctionError(404, "not_found", "Appeal not found.");
    if (appeal.outcome) throw new SanctionError(409, "already_decided", "This appeal was already decided.");
    if (input.outcome !== "upheld" && input.outcome !== "overturned") {
      throw new SanctionError(400, "invalid_outcome", 'Outcome must be "upheld" or "overturned".');
    }
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) || null : null;
    const decided = await this.repo.decideAppeal(id, { outcome: input.outcome, note, by: input.by, at: this.now() });
    if (input.outcome === "overturned") {
      const s = await this.repo.get(appeal.sanctionId);
      if (s && !s.liftedAt) await this.repo.lift(s.id, input.by, this.now());
    }
    return decided;
  }

  list(active: boolean) {
    return this.repo.list({ active, now: this.now() });
  }

  listAppeals(open: boolean) {
    return this.repo.listAppeals({ open });
  }
}

/** In-memory SanctionsRepo for tests. */
export class MemorySanctionsRepo implements SanctionsRepo {
  sanctions: AccountSanction[] = [];
  appeals: SanctionAppeal[] = [];
  private nextId = 1;

  private isActive(s: AccountSanction, now: Date) {
    return !s.liftedAt && (!s.endsAt || s.endsAt > now);
  }

  async activeFor(identity: AccountIdentity, now: Date) {
    const emails = new Set(identity.emails);
    return this.sanctions.filter(
      (s) =>
        this.isActive(s, now) &&
        (s.clerkUserId === identity.clerkUserId ||
          (!!identity.appleUserId && s.appleUserId === identity.appleUserId) ||
          s.emails.some((e) => emails.has(e))),
    );
  }
  async noneActive(now: Date) {
    return !this.sanctions.some((s) => this.isActive(s, now));
  }
  async create(input: NewSanction) {
    const row: AccountSanction = { ...input, id: this.nextId++, createdAt: new Date(), liftedAt: null, liftedBy: null };
    this.sanctions.push(row);
    return row;
  }
  async get(id: number) {
    return this.sanctions.find((s) => s.id === id) ?? null;
  }
  async lift(id: number, by: string, at: Date) {
    const s = this.sanctions.find((x) => x.id === id && !x.liftedAt);
    if (!s) return null;
    s.liftedAt = at;
    s.liftedBy = by;
    return s;
  }
  async list(opts: { active: boolean; now: Date }) {
    return this.sanctions.filter((s) => !opts.active || this.isActive(s, opts.now));
  }
  async appealFor(sanctionId: number) {
    return this.appeals.find((a) => a.sanctionId === sanctionId) ?? null;
  }
  async createAppeal(input: { sanctionId: number; clerkUserId: string; reportId: number | null }) {
    if (await this.appealFor(input.sanctionId)) return null;
    const row: SanctionAppeal = { ...input, id: this.nextId++, createdAt: new Date(), outcome: null, note: null, decidedAt: null, decidedBy: null };
    this.appeals.push(row);
    return row;
  }
  async getAppeal(id: number) {
    return this.appeals.find((a) => a.id === id) ?? null;
  }
  async listAppeals(opts: { open: boolean }) {
    return this.appeals.filter((a) => !opts.open || !a.outcome);
  }
  async decideAppeal(id: number, input: { outcome: AppealOutcome; note: string | null; by: string; at: Date }) {
    const a = this.appeals.find((x) => x.id === id)!;
    a.outcome = input.outcome;
    a.note = input.note;
    a.decidedBy = input.by;
    a.decidedAt = input.at;
    return a;
  }
}
