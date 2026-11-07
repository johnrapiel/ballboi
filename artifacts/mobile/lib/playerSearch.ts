// Player search (findings #15 and #18): the one search behind Quick match's
// opponent step and New message. Pure helpers only, so they're testable in
// Node; the data hook is hooks/usePlayerSearch.ts.

export interface PlayerSearchResult {
  /** Pick them in Quick match with this. */
  userId: number | null;
  /** Message them with this. Null when they aren't in any league or match yet. */
  playerId: number | null;
  name: string;
  avatarUrl: string | null;
  inYourLeagues: boolean;
  playedBefore: boolean;
}

export interface PlayerSearchResponse {
  players: PlayerSearchResult[];
  /** More people matched than came back: type more of the name. */
  more: boolean;
}

/** Wait this long after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Longest search the server reads. */
export const MAX_SEARCH = 60;

/** The address for a search. */
export function searchPath(query: string): string {
  const q = query.trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH);
  return q ? `/api/players/search?q=${encodeURIComponent(q)}` : "/api/players/search";
}

/**
 * Messaging by account (user id), from Discover (Wave 2 Session F): someone
 * with no player row yet (on Ball Boi, but in no league and no match) can be
 * messaged by their user id. New message sends `userId` for them.
 */
export const MESSAGE_BY_USER_ID = true;

export function canMessage(p: PlayerSearchResult): boolean {
  return p.playerId != null || (MESSAGE_BY_USER_ID && p.userId != null);
}

/** New message's two sections: "In your leagues", then "All Ball Boi players". */
export function newMessageSections(players: PlayerSearchResult[]): {
  leagues: PlayerSearchResult[];
  everyone: PlayerSearchResult[];
} {
  const messageable = players.filter(canMessage);
  return {
    leagues: messageable.filter((p) => p.inYourLeagues),
    everyone: messageable.filter((p) => !p.inYourLeagues),
  };
}

/** The Quick match body for a picked player: by account when we have it. */
export function quickMatchOpponent(p: PlayerSearchResult): { opponentUserId: number } | { opponentPlayerId: number } | null {
  if (p.userId != null) return { opponentUserId: p.userId };
  if (p.playerId != null) return { opponentPlayerId: p.playerId };
  return null;
}

/** A stable key per person for lists and the picked radio. */
export function personKey(p: PlayerSearchResult): string {
  return p.userId != null ? `u${p.userId}` : `p${p.playerId}`;
}

/** What VoiceOver reads after the name: how you know them, if you do. */
export function relationLabel(p: PlayerSearchResult): string | null {
  if (p.inYourLeagues) return "In your leagues";
  if (p.playedBefore) return "Played before";
  return null;
}

/** The line under the search when nothing matched. */
export function noResultsMessage(query: string, where: "quickMatch" | "newMessage"): { title: string; message: string } {
  const q = query.trim();
  const title = q ? `No players named "${q}"` : "No players yet";
  if (where === "quickMatch") {
    return { title, message: "Check the spelling, or add them as someone not on Ball Boi and send them a link." };
  }
  return { title, message: "Check the spelling, or try their first or last name." };
}
