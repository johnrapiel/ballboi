// Player search (Wave 1, findings #15 and #18, John Nov 6): one search shared
// by Quick match's opponent step and New message. It finds anyone on Ball Boi
// who hasn't hidden their profile, and never a blocked player, either way.
// The people you already know (league mates, past opponents) come first.
//
// The rules live here as plain functions; playerSearchRepo.ts only fetches.

/** Longest search the server reads. Display names are capped at 60 too. */
export const MAX_QUERY = 60;
/** Most "All Ball Boi players" results per search. Typing narrows it. */
export const STRANGER_LIMIT = 25;

/**
 * Hidden profile (finding #15): "Show me in Discover" off
 * (`discover_profiles.hidden`, Wave 2 Session F) also drops a player from
 * the "All Ball Boi players" part of Quick match and New message search
 * (see hiddenProfileFilter in playerSearchRepo.ts).
 * League mates and past opponents stay listed either way: the spec's hidden
 * profile opts out of discovery "while keeping leagues and Ball Boi".
 */
export const RESPECT_HIDDEN_PROFILE = true;

/** One person as the repo found them. */
export interface SearchCandidate {
  clerkUserId: string;
  /** users.id, for picking them in Quick match. Null for a league mate with no users row. */
  userId: number | null;
  /** A player row to message them by: their league-free one if they have it, else their first. */
  playerId: number | null;
  name: string;
  avatarUrl: string | null;
}

export interface ConnectedCandidate extends SearchCandidate {
  inYourLeagues: boolean;
  playedBefore: boolean;
}

export interface PlayerSearchResult {
  userId: number | null;
  playerId: number | null;
  name: string;
  avatarUrl: string | null;
  /** Shares a league with you: New message's "In your leagues". */
  inYourLeagues: boolean;
  /** You've played them before (any match). */
  playedBefore: boolean;
}

export interface PlayerSearchResponse {
  players: PlayerSearchResult[];
  /** True when there were more "All Ball Boi players" than STRANGER_LIMIT. */
  more: boolean;
}

/** Tidies a typed search: trimmed, single spaces, at most MAX_QUERY characters. */
export function cleanQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY);
}

/** Lowercased and without accents, so "jose" finds "José". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** True when every word of the query appears in the name ("al ki" finds "Alex Kim"). */
export function nameMatches(name: string, query: string): boolean {
  if (!query) return true;
  const n = fold(name);
  return fold(query)
    .split(" ")
    .every((word) => n.includes(word));
}

/** Escapes LIKE wildcards so a typed % or _ is matched literally. */
export function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * The search result: people you know first (league mates, then past
 * opponents), then everyone else, each person once, never you and never
 * anyone blocked either way. `strangers` is already limited to findable
 * accounts by the repo; it may hold up to STRANGER_LIMIT + connected + 1 rows
 * so de-duplicating still leaves a full page and tells us if there are more.
 */
export function buildSearchResults(input: {
  me: string;
  query: string;
  blocked: Set<string>;
  connected: ConnectedCandidate[];
  strangers: SearchCandidate[];
  limit?: number;
}): PlayerSearchResponse {
  const limit = input.limit ?? STRANGER_LIMIT;
  const skip = (id: string) => id === input.me || input.blocked.has(id);

  const known = new Map<string, ConnectedCandidate>();
  for (const c of input.connected) {
    if (skip(c.clerkUserId) || !nameMatches(c.name, input.query)) continue;
    const seen = known.get(c.clerkUserId);
    known.set(
      c.clerkUserId,
      seen
        ? {
            ...seen,
            userId: seen.userId ?? c.userId,
            playerId: seen.playerId ?? c.playerId,
            avatarUrl: seen.avatarUrl ?? c.avatarUrl,
            inYourLeagues: seen.inYourLeagues || c.inYourLeagues,
            playedBefore: seen.playedBefore || c.playedBefore,
          }
        : c,
    );
  }

  const others: SearchCandidate[] = [];
  const otherIds = new Set<string>();
  for (const s of input.strangers) {
    if (skip(s.clerkUserId) || known.has(s.clerkUserId) || otherIds.has(s.clerkUserId)) continue;
    if (!nameMatches(s.name, input.query)) continue;
    otherIds.add(s.clerkUserId);
    others.push(s);
  }
  others.sort(byName);

  const view = (c: SearchCandidate, inYourLeagues: boolean, playedBefore: boolean): PlayerSearchResult => ({
    userId: c.userId,
    playerId: c.playerId,
    name: c.name,
    avatarUrl: c.avatarUrl,
    inYourLeagues,
    playedBefore,
  });

  const knownList = [...known.values()].sort(
    (a, b) => Number(b.inYourLeagues) - Number(a.inYourLeagues) || byName(a, b),
  );
  return {
    players: [
      ...knownList.map((c) => view(c, c.inYourLeagues, c.playedBefore)),
      ...others.slice(0, limit).map((c) => view(c, false, false)),
    ],
    more: others.length > limit,
  };
}
