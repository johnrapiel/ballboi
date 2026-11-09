// Database side of the Live Activity (rules in liveActivityPlan.ts).

import { db, liveActivityTokensTable, liveSessionsTable, matchesTable, playersTable, usersTable, type LiveSession } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { sendLiveActivityPush, tokenIsDead, type ApnsEnv } from "./apns";
import {
  canControl,
  endPayload,
  liveViewers,
  needsStart,
  startAlert,
  startPayload,
  stoppedProps,
  updatePayload,
  worthPushing,
  type LiveCommand,
  type LiveProps,
} from "./liveActivityPlan";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface MatchPeople {
  recorderName: string;
  viewers: string[];
}

/** The match's players with accounts. Null when the match is gone or `userId` isn't on it. */
export async function matchPeople(matchId: number, userId: string, recorderId?: string): Promise<(MatchPeople & { recorderId: string }) | null> {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return null;
  const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const players = ids.length
    ? await db.select({ name: playersTable.name, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, ids))
    : [];
  const recorder = recorderId ?? userId;
  const me = players.find((p) => p.clerkUserId === recorder);
  if (!me) return null;
  const viewers = liveViewers(recorder, players);
  if (!canControl(userId, recorder, viewers)) return null;
  const [u] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.clerkUserId, recorder));
  return { recorderId: recorder, recorderName: u?.displayName ?? me.name, viewers };
}

export async function activeSession(matchId: number): Promise<LiveSession | null> {
  const [row] = await db
    .select()
    .from(liveSessionsTable)
    .where(and(eq(liveSessionsTable.matchId, matchId), eq(liveSessionsTable.status, "active")))
    .orderBy(desc(liveSessionsTable.id))
    .limit(1);
  return row ?? null;
}

async function push(row: { id: number; token: string; apnsEnv: string | null }, payload: unknown, priority: 5 | 10 = 10) {
  try {
    const r = await sendLiveActivityPush(row.token, payload, { knownEnv: (row.apnsEnv as ApnsEnv | null) ?? null, priority });
    if (!r) return;
    if (r.ok && r.env !== row.apnsEnv) {
      await db.update(liveActivityTokensTable).set({ apnsEnv: r.env, updatedAt: new Date() }).where(eq(liveActivityTokensTable.id, row.id));
    } else if (tokenIsDead(r)) {
      await db.delete(liveActivityTokensTable).where(eq(liveActivityTokensTable.id, row.id));
    } else if (!r.ok) {
      logger.warn({ status: r.status, reason: r.reason }, "Live Activity push refused");
    }
  } catch (err) {
    logger.warn({ err }, "Live Activity push failed");
  }
}

/** Opens the Live Activity on each viewer's phone that hasn't had it yet (G7). */
async function startForViewers(session: LiveSession, people: MatchPeople, props: LiveProps): Promise<void> {
  const todo = needsStart(people.viewers, session.startedFor);
  if (!todo.length) return;
  // Claimed before sending, so a second update never starts it twice.
  await db.update(liveSessionsTable).set({ startedFor: [...session.startedFor, ...todo] }).where(eq(liveSessionsTable.id, session.id));
  const tokens = await db
    .select()
    .from(liveActivityTokensTable)
    .where(and(eq(liveActivityTokensTable.kind, "start"), inArray(liveActivityTokensTable.clerkUserId, todo)));
  const payload = startPayload(props, nowSeconds(), startAlert(people.recorderName));
  await Promise.all(tokens.map((t) => push(t, payload)));
}

async function pushToActivities(sessionId: number, payload: unknown, priority: 5 | 10) {
  const tokens = await db
    .select()
    .from(liveActivityTokensTable)
    .where(and(eq(liveActivityTokensTable.kind, "activity"), eq(liveActivityTokensTable.sessionId, sessionId)));
  await Promise.all(tokens.map((t) => push(t, payload, priority)));
}

/**
 * The mounted phone's update (and heartbeat). Starts the session the first
 * time, opens the Live Activity on the other phones, forwards changes, and
 * hands back a Start or Stop waiting from another phone (once).
 */
export async function recorderUpdate(
  matchId: number,
  recorderId: string,
  props: LiveProps,
): Promise<{ command: LiveCommand | null } | null> {
  const people = await matchPeople(matchId, recorderId);
  if (!people || people.recorderId !== recorderId) return null;
  let session = await activeSession(matchId);
  if (session && session.recorderClerkUserId !== recorderId) {
    // Someone else's phone is already recording this match: theirs wins.
    return null;
  }
  const previous = (session?.props as LiveProps | undefined) ?? null;
  if (!session) {
    [session] = await db.insert(liveSessionsTable).values({ matchId, recorderClerkUserId: recorderId, props }).returning();
  }
  const command = session.pendingCommand as LiveCommand | null;
  await db
    .update(liveSessionsTable)
    .set({ props, updatedAt: new Date(), ...(command ? { pendingCommand: null } : {}) })
    .where(eq(liveSessionsTable.id, session.id));
  await startForViewers(session, people, props);
  if (worthPushing(previous, props)) {
    // A battery tick isn't urgent; everything else is.
    const onlyBattery = previous && previous.stage === props.stage && previous.caption === props.caption && previous.court === props.court;
    await pushToActivities(session.id, updatePayload(props, nowSeconds()), onlyBattery ? 5 : 10);
  }
  return { command };
}

/** The recording stopped or the recorder left: ends it everywhere. */
export async function endSession(matchId: number, recorderId: string, finalProps: LiveProps | null): Promise<boolean> {
  const session = await activeSession(matchId);
  if (!session || session.recorderClerkUserId !== recorderId) return false;
  const props = stoppedProps(finalProps ?? (session.props as LiveProps));
  await db
    .update(liveSessionsTable)
    .set({ status: "ended", props, pendingCommand: null, endedAt: new Date(), updatedAt: new Date() })
    .where(eq(liveSessionsTable.id, session.id));
  await pushToActivities(session.id, endPayload(props, nowSeconds()), 10);
  return true;
}

/** How long a stopped match still shows "Recording stopped" on the second phone. */
const SHOW_STOPPED_MS = 15 * 60_000;

async function recentlyEnded(matchId: number): Promise<LiveSession | null> {
  const [row] = await db
    .select()
    .from(liveSessionsTable)
    .where(and(eq(liveSessionsTable.matchId, matchId), eq(liveSessionsTable.status, "ended")))
    .orderBy(desc(liveSessionsTable.id))
    .limit(1);
  return row?.endedAt && Date.now() - row.endedAt.getTime() < SHOW_STOPPED_MS ? row : null;
}

/**
 * What a viewer's second phone shows: the live session, or one that stopped
 * in the last few minutes (so the screen says "Recording stopped" instead of
 * going blank), or nothing.
 */
export async function viewSession(matchId: number, userId: string): Promise<{ live: boolean; props: LiveProps | null; youRecord: boolean } | null> {
  const session = (await activeSession(matchId)) ?? (await recentlyEnded(matchId));
  if (!session) {
    // Anyone on the match may look, and sees nothing live.
    return (await matchPeople(matchId, userId)) ? { live: false, props: null, youRecord: false } : null;
  }
  if (!(await matchPeople(matchId, userId, session.recorderClerkUserId))) return null;
  return { live: session.status === "active", props: session.props as LiveProps, youRecord: session.recorderClerkUserId === userId };
}

/** Start or Stop from another phone (or the recorder's own Lock Screen). */
export async function sendCommand(
  matchId: number,
  userId: string,
  command: LiveCommand,
  allowed: (props: LiveProps, command: LiveCommand) => boolean,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const session = await activeSession(matchId);
  if (!session) return { ok: false, status: 404, error: "Nothing is recording this match right now." };
  const people = await matchPeople(matchId, userId, session.recorderClerkUserId);
  if (!people) return { ok: false, status: 404, error: "Nothing is recording this match right now." };
  if (!allowed(session.props as LiveProps, command)) {
    return {
      ok: false,
      status: 409,
      error: command === "start" ? "The match can't start from here right now." : "There's no recording to stop right now.",
    };
  }
  await db
    .update(liveSessionsTable)
    .set({ pendingCommand: command, commandByClerkUserId: userId, commandAt: new Date() })
    .where(eq(liveSessionsTable.id, session.id));
  return { ok: true };
}

/** This phone's push-to-start token (one per phone). */
export async function saveStartToken(userId: string, token: string): Promise<void> {
  await db
    .insert(liveActivityTokensTable)
    .values({ clerkUserId: userId, kind: "start", token })
    .onConflictDoUpdate({ target: liveActivityTokensTable.token, set: { clerkUserId: userId, kind: "start", updatedAt: new Date() } });
}

/**
 * A running Live Activity's update token. Tied to the match's live session,
 * or this account's newest one when the phone doesn't know the match (a Live
 * Activity Ball Boi's server started).
 */
export async function saveActivityToken(userId: string, token: string, activityId: string | null, matchId: number | null): Promise<boolean> {
  let session: LiveSession | null = null;
  if (matchId) {
    session = await activeSession(matchId);
    if (session && !(await matchPeople(matchId, userId, session.recorderClerkUserId))) session = null;
  } else {
    const mine = await db
      .select()
      .from(liveSessionsTable)
      .where(eq(liveSessionsTable.status, "active"))
      .orderBy(desc(liveSessionsTable.id))
      .limit(50);
    session = mine.find((s) => s.startedFor.includes(userId) || s.recorderClerkUserId === userId) ?? null;
  }
  if (!session) return false;
  await db
    .insert(liveActivityTokensTable)
    .values({ clerkUserId: userId, kind: "activity", token, activityId, sessionId: session.id })
    .onConflictDoUpdate({
      target: liveActivityTokensTable.token,
      set: { clerkUserId: userId, kind: "activity", activityId, sessionId: session.id, updatedAt: new Date() },
    });
  return true;
}

/**
 * A Quick match stranger said Yes (acceptance 33): if the match is being set
 * up or recorded right now, the Live Activity opens on their phone too.
 */
export async function startForNewViewer(matchId: number): Promise<void> {
  try {
    const session = await activeSession(matchId);
    if (!session) return;
    const people = await matchPeople(matchId, session.recorderClerkUserId);
    if (!people) return;
    await startForViewers(session, people, session.props as LiveProps);
  } catch (err) {
    logger.warn({ err, matchId }, "Couldn't start the Live Activity for a new viewer");
  }
}
