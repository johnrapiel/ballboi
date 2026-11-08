// The player card (spec decisions 138 and 139, John, Nov 8): the same card
// everywhere, your own on Profile and other players' from Discover. The card
// holds only what the player entered; This season sits under it.
//
// This season (Record, Played, Streak, No-shows) uses F13's rules
// (decision 121) inside the current season:
// - a match counts when it was scored against a real Ball Boi player
//   (league, Discover or Quick match), never against a placeholder;
// - a no-show counts only when a Discover no-show was confirmed or went
//   unanswered for 48 hours, never a disputed one, and never a league
//   "Not played".
// The season is the global season running today; with none running, the
// calendar year so far. Pure, so it's easy to test.

import { availabilitySummary } from "./discoverAvailability.js";

export interface SeasonWindow {
  name: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
}

/** The global season running on `today` (YYYY-MM-DD), else the calendar year. */
export function seasonWindow(seasons: { name: string; startDate: string; endDate: string }[], today: string): SeasonWindow {
  const running = seasons
    .filter((s) => s.startDate <= today && s.endDate >= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (running) return { name: running.name, from: running.startDate, to: running.endDate };
  const year = today.slice(0, 4);
  return { name: year, from: `${year}-01-01`, to: `${year}-12-31` };
}

/** True when an ISO time or YYYY-MM-DD date falls inside the window. */
export function inWindow(when: string | Date | null | undefined, w: SeasonWindow): boolean {
  if (!when) return false;
  const day = (typeof when === "string" ? when : when.toISOString()).slice(0, 10);
  return day >= w.from && day <= w.to;
}

export interface CardMatch {
  id: number;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  winnerId: number | null;
  completedAt: string | null;
}

export interface SeasonStats {
  wins: number;
  losses: number;
  played: number;
  /** Your latest results in a row; null before your first. */
  streak: { won: boolean; count: number } | null;
  noShows: number;
}

/**
 * This season for one account. `owner` maps player ids to accounts (null for
 * a placeholder). `noShows` is the account's confirmed Discover no-shows
 * already narrowed to the season.
 */
export function seasonStats(
  account: string,
  matches: CardMatch[],
  owner: (playerId: number) => string | null,
  window: SeasonWindow,
  noShows: number,
): SeasonStats {
  const results: { at: string; won: boolean | null; id: number }[] = [];
  for (const m of matches) {
    if (!inWindow(m.completedAt, window)) continue;
    const team1 = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
    const team2 = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
    const onTeam1 = team1.some((id) => owner(id) === account);
    const onTeam2 = team2.some((id) => owner(id) === account);
    if (onTeam1 === onTeam2) continue;
    const them = onTeam1 ? team2 : team1;
    if (!them.some((id) => { const o = owner(id); return o != null && o !== account; })) continue;
    const won = m.winnerId == null ? null : (m.winnerId === m.player1Id || m.winnerId === m.player3Id) === onTeam1;
    results.push({ at: m.completedAt ?? "", won, id: m.id });
  }
  results.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const decided = results.filter((r): r is { at: string; won: boolean; id: number } => r.won != null);
  let count = 0;
  for (const r of decided) {
    if (r.won !== decided[0].won) break;
    count++;
  }
  const wins = decided.filter((r) => r.won).length;
  return {
    wins,
    losses: decided.length - wins,
    played: results.length,
    streak: decided.length ? { won: decided[0].won, count } : null,
    noShows,
  };
}

const PLAYS = new Set(["singles", "doubles", "both"]);

export interface CardPerson {
  userId: number;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  ratingSource: string | null;
  town: string | null;
  plays: string | null;
  homeCourt: string | null;
  slots: number[];
}

/** What the card shows: only what the player entered. */
export function cardView(p: CardPerson, extra: { distance: string | null; season: SeasonWindow & SeasonStats; you: boolean }) {
  return {
    userId: p.userId,
    you: extra.you,
    name: p.name,
    avatarUrl: p.avatarUrl,
    rating: p.rating,
    ratingSource: p.ratingSource,
    plays: p.plays && PLAYS.has(p.plays) ? (p.plays as "singles" | "doubles" | "both") : null,
    town: p.town,
    distance: extra.distance,
    homeCourt: p.homeCourt,
    slots: [...p.slots].sort((a, b) => a - b),
    freeSummary: availabilitySummary(p.slots),
    season: extra.season,
  };
}
