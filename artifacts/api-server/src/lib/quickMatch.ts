// Quick match (spec: Ball Boi > Recording): "format first (singles by
// default), then any opponent. A non-user becomes a placeholder with an
// invite link; you get solo controls, and nothing counts toward standings
// until they join."

import { customAlphabet } from "nanoid";
import { checkTennisScore } from "./tennisScore.js";

/** No 0/O or 1/I, so a code read aloud or typed can't be misread. */
export const newInviteCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

/**
 * The link a placeholder opponent opens. It opens Ball Boi through
 * associated domains once ballboi.tennis serves an apple-app-site-association
 * file; until then it needs a page there that points to the App Store.
 */
export function inviteUrl(code: string): string {
  return `https://ballboi.tennis/record/invite/${code}`;
}

export const MAX_NAME = 60;

export type QuickMatchRequest =
  | { ok: true; opponentPlayerId: number; opponentUserId?: undefined; opponentName?: undefined }
  | { ok: true; opponentPlayerId?: undefined; opponentUserId: number; opponentName?: undefined }
  | { ok: true; opponentPlayerId?: undefined; opponentUserId?: undefined; opponentName: string }
  | { ok: false; error: string };

/**
 * Reads POST /recording/quick-matches. Exactly one of opponentPlayerId,
 * opponentUserId (someone found with player search) or opponentName.
 */
export function parseQuickMatch(body: unknown): QuickMatchRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const format = b.format ?? "singles";
  if (format === "doubles") return { ok: false, error: "Ball Boi analyzes singles for now. Doubles is coming." };
  if (format !== "singles") return { ok: false, error: "Choose singles or doubles." };
  const id = b.opponentPlayerId;
  const userId = b.opponentUserId;
  const name = typeof b.opponentName === "string" ? b.opponentName.trim().replace(/\s+/g, " ") : "";
  if ([id != null, userId != null, !!name].filter(Boolean).length > 1) {
    return { ok: false, error: "Pick a player or type a name, not both." };
  }
  const validId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
  if (id != null) {
    if (!validId(id)) return { ok: false, error: "Pick a player." };
    return { ok: true, opponentPlayerId: id };
  }
  if (userId != null) {
    if (!validId(userId)) return { ok: false, error: "Pick a player." };
    return { ok: true, opponentUserId: userId };
  }
  if (!name) return { ok: false, error: "Who are you playing? Type their name." };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };
  return { ok: true, opponentName: name };
}

export interface OpponentRow {
  id: number;
  name: string;
  clerkUserId: string | null;
}

export interface Opponent {
  playerId: number;
  name: string;
}

/**
 * People you can pick for a Quick match: league mates and past opponents
 * with a Ball Boi account, one entry per person, minus yourself and anyone
 * blocked either way. Sorted by name.
 */
export function pickableOpponents(rows: OpponentRow[], me: string, blocked: Set<string>): Opponent[] {
  const byAccount = new Map<string, Opponent>();
  for (const r of rows) {
    if (!r.clerkUserId || r.clerkUserId === me || blocked.has(r.clerkUserId)) continue;
    const seen = byAccount.get(r.clerkUserId);
    if (!seen || r.id < seen.playerId) byAccount.set(r.clerkUserId, { playerId: r.id, name: r.name });
  }
  return [...byAccount.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type ScoreParse = { ok: true; score: string; winnerSide: 1 | 2 } | { ok: false; error: string };

/**
 * Reads a score written from the side of the player entering it ("6-3, 7-6(4)":
 * their games first). Only real tennis sets (C10), but as many as were
 * played, one to five: Quick matches aren't best of three. The winner has
 * more sets, then more games; level on both is refused.
 */
export function parseSideScore(raw: unknown): ScoreParse {
  if (typeof raw !== "string") return { ok: false, error: "Enter the score for each set, like 6-4." };
  const check = checkTennisScore(raw, { quick: true });
  if (!check.ok) return check;
  return { ok: true, score: check.sets.join(", "), winnerSide: check.winnerSide };
}

/** Flips a score to the other side's view: "6-3, 7-6(4)" becomes "3-6, 6-7(4)". */
export function flipScore(score: string): string {
  return score
    .split(",")
    .map((set) => {
      const m = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ""}` : set.trim();
    })
    .join(", ");
}
