import { clerkClient } from "@clerk/express";
import {
  accountSanctionsTable,
  contentReportsTable,
  db,
  sanctionAppealsTable,
  type AppealOutcome,
  type SanctionKind,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { appealReference, normalizeEmails, SanctionsService, type AccountIdentity, type NewSanction, type SanctionsRepo } from "./sanctions";

const activeAt = (now: Date) =>
  and(isNull(accountSanctionsTable.liftedAt), or(isNull(accountSanctionsTable.endsAt), gt(accountSanctionsTable.endsAt, now)));

/** SanctionsRepo on Postgres. */
export class DrizzleSanctionsRepo implements SanctionsRepo {
  private get t() {
    return accountSanctionsTable;
  }

  async activeFor(identity: AccountIdentity, now: Date) {
    const keys: SQL[] = [eq(this.t.clerkUserId, identity.clerkUserId)];
    if (identity.appleUserId) keys.push(eq(this.t.appleUserId, identity.appleUserId));
    if (identity.emails.length) {
      const list = sql.join(identity.emails.map((e) => sql`${e}`), sql`, `);
      keys.push(sql`jsonb_exists_any(${this.t.emails}, ARRAY[${list}]::text[])`);
    }
    const rows = await db.select().from(this.t).where(and(activeAt(now), or(...keys)));
    return rows.map((r) => ({ ...r, kind: r.kind as SanctionKind }));
  }

  async noneActive(now: Date) {
    const [row] = await db.select({ id: this.t.id }).from(this.t).where(activeAt(now)).limit(1);
    return !row;
  }

  async create(input: NewSanction) {
    const [row] = await db.insert(this.t).values(input).returning();
    return row;
  }

  async get(id: number) {
    const [row] = await db.select().from(this.t).where(eq(this.t.id, id));
    return row ?? null;
  }

  async lift(id: number, by: string, at: Date) {
    const [row] = await db
      .update(this.t)
      .set({ liftedAt: at, liftedBy: by })
      .where(and(eq(this.t.id, id), isNull(this.t.liftedAt)))
      .returning();
    return row ?? null;
  }

  async list(opts: { active: boolean; now: Date }) {
    return db
      .select()
      .from(this.t)
      .where(opts.active ? activeAt(opts.now) : undefined)
      .orderBy(desc(this.t.createdAt))
      .limit(200);
  }

  async appealFor(sanctionId: number) {
    const [row] = await db.select().from(sanctionAppealsTable).where(eq(sanctionAppealsTable.sanctionId, sanctionId));
    return row ?? null;
  }

  async createAppeal(input: { sanctionId: number; clerkUserId: string; reportId: number | null }) {
    const [row] = await db.insert(sanctionAppealsTable).values(input).onConflictDoNothing().returning();
    return row ?? null;
  }

  async getAppeal(id: number) {
    const [row] = await db.select().from(sanctionAppealsTable).where(eq(sanctionAppealsTable.id, id));
    return row ?? null;
  }

  async listAppeals(opts: { open: boolean }) {
    return db
      .select()
      .from(sanctionAppealsTable)
      .where(opts.open ? isNull(sanctionAppealsTable.outcome) : undefined)
      .orderBy(desc(sanctionAppealsTable.createdAt))
      .limit(200);
  }

  async decideAppeal(id: number, input: { outcome: AppealOutcome; note: string | null; by: string; at: Date }) {
    const [row] = await db
      .update(sanctionAppealsTable)
      .set({ outcome: input.outcome, note: input.note, decidedBy: input.by, decidedAt: input.at })
      .where(eq(sanctionAppealsTable.id, id))
      .returning();
    // The appeal's row in the reports queue is closed with the decision.
    if (row?.reportId) {
      await db
        .update(contentReportsTable)
        .set({ status: "reviewed", reviewedAt: input.at })
        .where(eq(contentReportsTable.id, row.reportId));
    }
    return row;
  }
}

interface ClerkExternalAccount {
  provider?: string;
  providerUserId?: string;
  externalId?: string;
}

/** The Clerk account's Sign in with Apple user ID and email addresses. */
export async function identityFromClerk(clerkUserId: string): Promise<AccountIdentity> {
  const user = await clerkClient.users.getUser(clerkUserId);
  const accounts = (user.externalAccounts ?? []) as unknown as ClerkExternalAccount[];
  const apple = accounts.find((a) => typeof a.provider === "string" && a.provider.includes("apple"));
  const emails = normalizeEmails([
    ...(user.emailAddresses ?? []).map((e: { emailAddress: string }) => e.emailAddress),
    ...accounts.map((a) => (a as { emailAddress?: string }).emailAddress),
  ]);
  return { clerkUserId, appleUserId: apple?.providerUserId ?? apple?.externalId ?? null, emails };
}

let service: SanctionsService | null = null;

export function getSanctionsService(): SanctionsService {
  service ??= new SanctionsService(new DrizzleSanctionsRepo(), async ({ clerkUserId, sanction }) => {
    const [row] = await db
      .insert(contentReportsTable)
      .values({
        reporterClerkUserId: clerkUserId,
        targetType: "account",
        targetId: clerkUserId,
        reason: "other",
        details: `Appeal ${appealReference(sanction.id)} against a ${sanction.kind}. The person was told to email their appeal; decide it with POST /api/admin/appeals/:id/decide.`,
        source: "appeal",
        subjectClerkUserId: clerkUserId,
      })
      .returning({ id: contentReportsTable.id });
    return row?.id ?? null;
  });
  return service;
}
