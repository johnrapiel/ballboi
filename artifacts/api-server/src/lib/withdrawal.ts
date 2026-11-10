// Withdrawing from Ball Boi's recordings (spec decision 95, B12; the Beta
// Footage Release, "Withdrawing"). Runs when a player deletes their account,
// after the account's own data is gone.
//
// - Every recording of a match they played, whoever recorded it, is marked
//   withdrawn and its videos are deleted now: the raw upload, any pieces, and
//   the video-only copy kept for testing or training. A delete that fails is
//   retried by the hourly sweep (videoRetention.ts), well inside 30 days.
//   Stats and shot data stay, so the other player keeps their match.
// - support@ballboi.tennis gets the list of those matches, so John deletes
//   their test-set copies on his Mac. Hand-made shot labels stay, without the
//   name; models already trained aren't rebuilt.

import { ballBoiSessionsTable, db, matchesTable } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import { settleSessionVideo } from "./videoRetention";
import { sendSupportEmail, type SendResult, type SupportEmail } from "./supportEmail";

type Session = typeof ballBoiSessionsTable.$inferSelect;

export interface WithdrawnMatch {
  matchId: number;
  sessionId: number;
  recordedAt: Date | null;
}

export interface WithdrawalInput {
  clerkUserId: string;
  /** The account's player rows, captured before they were anonymized. */
  playerIds: number[];
  /** Recordings deleted outright with the account (no opponent left to keep them). */
  deletedSessions: WithdrawnMatch[];
}

export interface WithdrawalDeps {
  /** Every recording of a match these players played in. */
  findSessions(playerIds: number[]): Promise<Session[]>;
  /** Marks a recording withdrawn and deletes its videos. */
  markAndPurge(session: Session, withdrawnAt: string): Promise<void>;
  send(email: SupportEmail): Promise<SendResult>;
  now(): Date;
}

const defaultDeps: WithdrawalDeps = {
  async findSessions(playerIds) {
    if (playerIds.length === 0) return [];
    const matches = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(
        or(
          inArray(matchesTable.player1Id, playerIds),
          inArray(matchesTable.player2Id, playerIds),
          inArray(matchesTable.player3Id, playerIds),
          inArray(matchesTable.player4Id, playerIds),
        ),
      );
    if (matches.length === 0) return [];
    return db.select().from(ballBoiSessionsTable).where(inArray(ballBoiSessionsTable.matchId, matches.map((m) => m.id)));
  },
  async markAndPurge(session, withdrawnAt) {
    const base = session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
    const metadata = { ...base, withdrawnAt: typeof base.withdrawnAt === "string" ? base.withdrawnAt : withdrawnAt };
    await db.update(ballBoiSessionsTable).set({ metadata }).where(eq(ballBoiSessionsTable.id, session.id));
    await settleSessionVideo({ ...session, metadata });
  },
  send: (email) => sendSupportEmail(email),
  now: () => new Date(),
};

/** The email listing the test-set copies to delete. Pure, for tests. */
export function withdrawalEmail(clerkUserId: string, matches: WithdrawnMatch[], at: Date): SupportEmail {
  const sorted = [...matches].sort((a, b) => a.matchId - b.matchId || a.sessionId - b.sessionId);
  const lines = sorted.map(
    (m) => `- Match ${m.matchId}, recording ${m.sessionId}${m.recordedAt ? `, recorded ${m.recordedAt.toISOString().slice(0, 10)}` : ""}`,
  );
  return {
    subject: `Withdrawal: delete test-set copies for ${sorted.length} ${sorted.length === 1 ? "match" : "matches"}`,
    text: [
      `A player deleted their account on ${at.toISOString().slice(0, 10)} (${clerkUserId}).`,
      "",
      "Ball Boi has deleted the video and audio of these recordings from its storage. Delete any copies of them in the labeled test set on your Mac, audio included, within 30 days of that date. Hand-made shot labels can stay, with the player's name removed.",
      "",
      ...lines,
    ].join("\n"),
  };
}

export interface WithdrawalSummary {
  recordingsWithdrawn: number;
  emailed: boolean;
}

type Log = { warn: (o: object, m: string) => void; info: (o: object, m: string) => void };

export async function withdrawFromRecordings(
  input: WithdrawalInput,
  log: Log,
  deps: WithdrawalDeps = defaultDeps,
): Promise<WithdrawalSummary> {
  const at = deps.now();
  const sessions = await deps.findSessions(input.playerIds);
  for (const s of sessions) {
    try {
      await deps.markAndPurge(s, at.toISOString());
    } catch (err) {
      log.warn({ err, sessionId: s.id }, "Withdrawal: couldn't delete a recording's video yet; the hourly sweep retries");
    }
  }
  const listed = new Map<number, WithdrawnMatch>();
  for (const s of sessions) listed.set(s.id, { matchId: s.matchId, sessionId: s.id, recordedAt: s.recordingStartedAt ?? s.createdAt ?? null });
  for (const d of input.deletedSessions) listed.set(d.sessionId, d);
  if (listed.size === 0) return { recordingsWithdrawn: 0, emailed: false };

  const sent = await deps.send(withdrawalEmail(input.clerkUserId, [...listed.values()], at));
  if (!sent.sent) {
    // Nothing is lost: the sessions carry withdrawnAt, and this log line has the list.
    log.warn({ matches: [...listed.values()].map((m) => m.matchId) }, "Withdrawal: the test-set email didn't go out; send the list to support by hand");
  }
  log.info({ recordingsWithdrawn: sessions.length }, "Withdrawal: recordings marked and videos deleted");
  return { recordingsWithdrawn: sessions.length, emailed: sent.sent };
}
