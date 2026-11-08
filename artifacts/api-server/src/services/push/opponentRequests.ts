// Database side of the opponent notice and "Was that you?" (rules in
// opponentNotice.ts).

import {
  db,
  matchInvitesTable,
  matchPlansTable,
  matchesTable,
  opponentNoticesTable,
  opponentRequestsTable,
  playersTable,
  type OpponentRequest,
} from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { readBetaRelease } from "../../lib/betaRelease";
import { newInviteCode } from "../../lib/quickMatch";
import { DrizzlePlayerSearchRepo } from "../../lib/playerSearchRepo";
import {
  answerRequest,
  isStranger,
  NOT_ME_NAME,
  OPPONENT_NOTICE_TITLE,
  opponentNoticeBody,
  planOpponentNotices,
  wasThatYouBody,
} from "./opponentNotice";

type Push = (userIds: string[], title: string, body: string, link: string) => Promise<void>;

/** True when a Quick match against this account needs "Was that you?" first. */
export async function quickMatchStranger(me: string, opponentClerkUserId: string): Promise<boolean> {
  const connected = await new DrizzlePlayerSearchRepo().connected(me);
  const plans = await db
    .select({ a: matchPlansTable.proposerClerkUserId, b: matchPlansTable.recipientClerkUserId })
    .from(matchPlansTable)
    .where(
      and(
        eq(matchPlansTable.status, "accepted"),
        or(
          and(eq(matchPlansTable.proposerClerkUserId, me), eq(matchPlansTable.recipientClerkUserId, opponentClerkUserId)),
          and(eq(matchPlansTable.proposerClerkUserId, opponentClerkUserId), eq(matchPlansTable.recipientClerkUserId, me)),
        ),
      ),
    );
  return isStranger({
    opponentClerkUserId,
    connected: new Set(connected.map((c) => c.clerkUserId)),
    acceptedPlanWith: new Set(plans.length ? [opponentClerkUserId] : []),
  });
}

/**
 * A Quick match against a stranger: an unlinked stand-in with their name, and
 * an invite only they can answer. The recorder never gets the code.
 */
export async function createStrangerQuickMatch(input: {
  recorderId: string;
  recorderPlayerId: number;
  opponentClerkUserId: string;
  opponentName: string;
  scheduledAt: string;
}): Promise<{ matchId: number }> {
  const code = newInviteCode();
  return db.transaction(async (tx) => {
    const [standIn] = await tx.insert(playersTable).values({ name: input.opponentName }).returning({ id: playersTable.id });
    const [match] = await tx
      .insert(matchesTable)
      .values({
        player1Id: input.recorderPlayerId,
        player2Id: standIn.id,
        scheduledAt: input.scheduledAt,
        status: "scheduled",
        generatedFrom: "quick_match",
      })
      .returning({ id: matchesTable.id });
    await tx.insert(matchInvitesTable).values({ code, matchId: match.id, placeholderPlayerId: standIn.id, createdByClerkUserId: input.recorderId });
    await tx.insert(opponentRequestsTable).values({
      code,
      matchId: match.id,
      recorderClerkUserId: input.recorderId,
      opponentClerkUserId: input.opponentClerkUserId,
    });
    return { matchId: match.id };
  });
}

/**
 * Recording started on the mounted phone. Sends the notices and the request,
 * each at most once. Returns null when the caller isn't in the match.
 */
export async function sendOpponentNotices(matchId: number, recorderId: string, push: Push): Promise<{ notified: number; requested: boolean } | null> {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match) return null;
  const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const players = ids.length
    ? await db.select({ id: playersTable.id, name: playersTable.name, clerkUserId: playersTable.clerkUserId }).from(playersTable).where(inArray(playersTable.id, ids))
    : [];
  const mine = players.find((p) => p.clerkUserId === recorderId);
  if (!mine) return null;
  const [request] = await db.select().from(opponentRequestsTable).where(eq(opponentRequestsTable.matchId, matchId));

  const plan = planOpponentNotices({ recorderId, players, request: request ?? null, beta: readBetaRelease().required });
  let notified = 0;
  for (const to of plan.notice) {
    // Claimed first, so a second start never sends twice.
    const [claimed] = await db.insert(opponentNoticesTable).values({ matchId, clerkUserId: to }).onConflictDoNothing().returning({ id: opponentNoticesTable.id });
    if (!claimed) continue;
    await push([to], OPPONENT_NOTICE_TITLE, opponentNoticeBody(mine.name), `/match/${matchId}`).catch(() => undefined);
    notified++;
  }
  let requested = false;
  if (plan.request) {
    const [claimed] = await db
      .update(opponentRequestsTable)
      .set({ notifiedAt: new Date() })
      .where(and(eq(opponentRequestsTable.code, plan.request.code), isNull(opponentRequestsTable.notifiedAt)))
      .returning({ code: opponentRequestsTable.code });
    if (claimed) {
      await push([plan.request.to], "", wasThatYouBody(mine.name), `/record/invite/${plan.request.code}`).catch(() => undefined);
      requested = true;
    }
  }
  return { notified, requested };
}

export async function requestForCode(code: string): Promise<OpponentRequest | null> {
  const [row] = await db.select().from(opponentRequestsTable).where(eq(opponentRequestsTable.code, code));
  return row ?? null;
}

/** Yes: called inside the invite claim's transaction. */
export async function markRequestYes(tx: Pick<typeof db, "update">, code: string): Promise<void> {
  await tx
    .update(opponentRequestsTable)
    .set({ status: "yes", answeredAt: new Date() })
    .where(and(eq(opponentRequestsTable.code, code), eq(opponentRequestsTable.status, "pending")));
}

/**
 * Not me: the request closes (so the invite can't be claimed: see the
 * claim route), and the stand-in gets a plain name so the stranger's name
 * leaves the recorder's match.
 */
export async function answerNotMe(code: string, me: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const request = await requestForCode(code);
  if (!request || request.opponentClerkUserId !== me) return { ok: false, status: 404, error: "This request isn't available." };
  const next = answerRequest(request.status, "not_me");
  if (!next.ok) return { ok: false, status: 409, error: next.error };
  if (request.status === "not_me") return { ok: true };
  await db.transaction(async (tx) => {
    await tx
      .update(opponentRequestsTable)
      .set({ status: "not_me", answeredAt: new Date() })
      .where(and(eq(opponentRequestsTable.code, code), eq(opponentRequestsTable.status, "pending")));
    const [invite] = await tx
      .select({ placeholderPlayerId: matchInvitesTable.placeholderPlayerId })
      .from(matchInvitesTable)
      .where(and(eq(matchInvitesTable.code, code), isNull(matchInvitesTable.claimedByClerkUserId)));
    if (invite) {
      await tx
        .update(playersTable)
        .set({ name: NOT_ME_NAME })
        .where(and(eq(playersTable.id, invite.placeholderPlayerId), isNull(playersTable.clerkUserId)));
    }
  });
  return { ok: true };
}
