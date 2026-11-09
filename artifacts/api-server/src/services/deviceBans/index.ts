// DeviceCheck device bans: the database and Apple side (rules in plan.ts).

import { db, deviceBansTable, deviceCheckTokensTable, type DeviceBan } from "@workspace/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { getSanctionsService, identityFromClerk, namesFor } from "../../messaging/drizzleSanctions";
import { clearSanctionsCache } from "../../messaging/enforceSanctions";
import type { AccountIdentity } from "../../messaging/sanctions";
import { queryBits, updateBits, type AppleEnv } from "./appleDeviceCheck";
import { CAUGHT_REASON, checkInAction, deviceBanLabel } from "./plan";

const MARK = { bit0: true, bit1: false };
const CLEAR = { bit0: false, bit1: false };

async function identityOf(clerkUserId: string): Promise<AccountIdentity> {
  try {
    return await identityFromClerk(clerkUserId);
  } catch {
    return { clerkUserId, appleUserId: null, emails: [] };
  }
}

async function rowsFor(clerkUserId: string): Promise<DeviceBan[]> {
  return db.select().from(deviceBansTable).where(eq(deviceBansTable.clerkUserId, clerkUserId)).orderBy(desc(deviceBansTable.id));
}

async function setMarked(ids: number[], marked: "yes" | "no") {
  for (const id of ids) await db.update(deviceBansTable).set({ phoneMarked: marked }).where(eq(deviceBansTable.id, id));
}

/**
 * Ball Boi opened on a phone (POST /account/device-check). Saves the token,
 * reads the phone's bits and acts on them. Returns "blocked" when this
 * account was just banned for using a banned phone.
 */
export async function checkIn(clerkUserId: string, token: string): Promise<"ok" | "blocked"> {
  const [saved] = await db
    .insert(deviceCheckTokensTable)
    .values({ clerkUserId, token })
    .onConflictDoUpdate({ target: deviceCheckTokensTable.clerkUserId, set: { token, updatedAt: new Date() } })
    .returning();
  const bits = await queryBits(token, (saved?.appleEnv as AppleEnv | null) ?? null);
  if (!bits.ok) {
    if (bits.status) logger.warn({ status: bits.status, reason: bits.reason }, "DeviceCheck query refused");
    return "ok";
  }
  if (saved && saved.appleEnv !== bits.env) {
    await db.update(deviceCheckTokensTable).set({ appleEnv: bits.env }).where(eq(deviceCheckTokensTable.id, saved.id));
  }
  const own = await rowsFor(clerkUserId);
  const ownActive = own.filter((r) => r.kind === "banned" && !r.liftedAt);
  const ownUndone = own.some((r) => r.liftedAt) && !own.some((r) => !r.liftedAt);
  const accountBanned = (await getSanctionsService().current(await identityOf(clerkUserId)))?.kind === "ban";
  const action = checkInAction({
    phoneMarked: bits.bits.bit0,
    ownBanActive: ownActive.length > 0,
    ownBanUndone: ownUndone,
    accountBanned,
  });
  if (action === "mark") {
    const r = await updateBits(token, MARK, bits.env);
    if (r.ok) await setMarked(ownActive.map((x) => x.id), "yes");
    return "ok";
  }
  if (action === "clear") {
    await updateBits(token, CLEAR, bits.env);
    return "ok";
  }
  if (action === "block") {
    const sanction = await getSanctionsService().sanction({
      kind: "ban",
      identity: await identityOf(clerkUserId),
      reason: CAUGHT_REASON,
      reportId: null,
      by: "device-check",
    });
    await db.insert(deviceBansTable).values({
      clerkUserId,
      kind: "caught",
      sanctionId: sanction.id,
      phoneMarked: "yes",
      reason: CAUGHT_REASON,
      createdBy: "device-check",
    });
    clearSanctionsCache();
    logger.warn("A new account on a banned phone was banned (device ban)");
    return "blocked";
  }
  return "ok";
}

/**
 * A moderator banned an account: marks the phone it last used, if Ball Boi
 * knows it, and records the phone ban for the admin queue. A phone that isn't
 * known yet is marked the next time the banned account opens Ball Boi.
 */
export async function banDevicesFor(clerkUserId: string, sanctionId: number, reason: string, by: string): Promise<void> {
  const [row] = await db
    .insert(deviceBansTable)
    .values({ clerkUserId, kind: "banned", sanctionId, reason, createdBy: by })
    .returning();
  const [t] = await db.select().from(deviceCheckTokensTable).where(eq(deviceCheckTokensTable.clerkUserId, clerkUserId));
  if (!t || !row) return;
  const r = await updateBits(t.token, MARK, (t.appleEnv as AppleEnv | null) ?? null);
  if (r.ok) await setMarked([row.id], "yes");
}

/**
 * Undo from the admin queue, or the account ban was lifted or overturned:
 * the phone ban ends. Clears the phone's mark now if its token still works;
 * otherwise it's cleared the next time that account opens Ball Boi.
 * Undoing a phone ban also lifts the account ban that came with it.
 */
export async function undoDeviceBan(id: number, by: string, opts: { liftSanction: boolean }): Promise<DeviceBan | null> {
  const [row] = await db
    .update(deviceBansTable)
    .set({ liftedAt: new Date(), liftedBy: by })
    .where(and(eq(deviceBansTable.id, id), isNull(deviceBansTable.liftedAt)))
    .returning();
  if (!row) return null;
  const [t] = await db.select().from(deviceCheckTokensTable).where(eq(deviceCheckTokensTable.clerkUserId, row.clerkUserId));
  if (t) {
    const r = await updateBits(t.token, CLEAR, (t.appleEnv as AppleEnv | null) ?? null);
    if (r.ok) await setMarked([row.id], "no");
  }
  if (opts.liftSanction && row.sanctionId) {
    await getSanctionsService()
      .lift(row.sanctionId, by)
      .catch(() => undefined);
    clearSanctionsCache();
  }
  return row;
}

/** The account ban was lifted (or its appeal overturned): its phone ban goes too. */
export async function undoDeviceBansForSanction(sanctionId: number, by: string): Promise<void> {
  const rows = await db
    .select()
    .from(deviceBansTable)
    .where(and(eq(deviceBansTable.sanctionId, sanctionId), isNull(deviceBansTable.liftedAt)));
  for (const r of rows) await undoDeviceBan(r.id, by, { liftSanction: false });
}

export interface DeviceBanView {
  id: number;
  clerkUserId: string;
  name: string | null;
  kind: string;
  label: string;
  reason: string;
  phoneMarked: boolean;
  createdAt: string;
  liftedAt: string | null;
}

/** The admin queue: phone bans, newest first. */
export async function listDeviceBans(active: boolean): Promise<DeviceBanView[]> {
  const rows = await db
    .select()
    .from(deviceBansTable)
    .where(active ? isNull(deviceBansTable.liftedAt) : isNotNull(deviceBansTable.liftedAt))
    .orderBy(desc(deviceBansTable.id))
    .limit(200);
  const names = await namesFor(rows.map((r) => r.clerkUserId));
  return rows.map((r) => ({
    id: r.id,
    clerkUserId: r.clerkUserId,
    name: names.get(r.clerkUserId) ?? null,
    kind: r.kind,
    label: deviceBanLabel(r.kind, r.phoneMarked),
    reason: r.reason,
    phoneMarked: r.phoneMarked === "yes",
    createdAt: r.createdAt.toISOString(),
    liftedAt: r.liftedAt?.toISOString() ?? null,
  }));
}

/** Account deletion: the account's DeviceCheck token goes; its phone bans stay (acceptance 41). */
export async function deleteDeviceCheckToken(tx: Pick<typeof db, "delete">, clerkUserId: string): Promise<void> {
  await tx.delete(deviceCheckTokensTable).where(eq(deviceCheckTokensTable.clerkUserId, clerkUserId));
}
