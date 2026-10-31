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

export type ScoreParse = { ok: true; score: string; winnerSide: 1 | 2 } | { ok: false; error: string };

/**
 * Reads a score written from the side of the player entering it ("6-3, 7-6(4)":
 * their games first). Same rules as league scores: every set has a winner, and
 * a split match needs a deciding set or match tiebreak.
 */
export function parseSideScore(raw: unknown): ScoreParse {
  if (typeof raw !== "string") return { ok: false, error: "Enter the score for each set, like 6-4." };
  const sets = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (sets.length === 0) return { ok: false, error: "Enter the score for each set, like 6-4." };
  if (sets.length > 5) return { ok: false, error: "A match has at most 5 sets." };
  let mine = 0;
  let theirs = 0;
  for (const set of sets) {
    const m = set.match(/^(\d{1,2})-(\d{1,2})(\((\d{1,2})\))?$/);
    if (!m) return { ok: false, error: `"${set}" isn't a set score. Use a format like 6-4.` };
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === b) return { ok: false, error: `"${set}" is tied. Every set needs a winner.` };
    if (a > b) mine++;
    else theirs++;
  }
  if (mine === theirs) {
    return { ok: false, error: "The sets are tied. If you played a match tiebreak, add it as the last set (like 10-7)." };
  }
  return { ok: true, score: sets.join(", "), winnerSide: mine > theirs ? 1 : 2 };
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
