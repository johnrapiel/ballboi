// Quick match (spec: Ball Boi > Recording): "format first (singles by
// default), then any opponent. A non-user becomes a placeholder with an
// invite link; you get solo controls, and nothing counts toward standings
// until they join."

import { customAlphabet } from "nanoid";

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
  | { ok: true; opponentPlayerId: number; opponentName?: undefined }
  | { ok: true; opponentPlayerId?: undefined; opponentName: string }
  | { ok: false; error: string };

/** Reads POST /recording/quick-matches. Exactly one of opponentPlayerId or opponentName. */
export function parseQuickMatch(body: unknown): QuickMatchRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const format = b.format ?? "singles";
  if (format === "doubles") return { ok: false, error: "Ball Boi analyzes singles for now. Doubles is coming." };
  if (format !== "singles") return { ok: false, error: "Choose singles or doubles." };
  const id = b.opponentPlayerId;
  const name = typeof b.opponentName === "string" ? b.opponentName.trim().replace(/\s+/g, " ") : "";
  if (id != null && name) return { ok: false, error: "Pick a player or type a name, not both." };
  if (id != null) {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return { ok: false, error: "Pick a player." };
    return { ok: true, opponentPlayerId: id };
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
