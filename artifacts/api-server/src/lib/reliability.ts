// Reliability on player cards (spec: Discover, "From found to playing" 6;
// F12, F13): "Played 14 · 1 no-show", or "New to Ball Boi".
//
// - Played counts every scored match against a real Ball Boi player (league,
//   Discover or Quick match): an opponent with an account, not a placeholder.
// - No-show counts only Discover no-shows that were confirmed or went
//   unanswered for 48 hours. A disputed one ("That's not right") counts on
//   neither card, and a league "Not played" never counts.

export interface Reliability {
  played: number;
  noShows: number;
  wins: number;
  losses: number;
}

export const EMPTY_RELIABILITY: Reliability = { played: 0, noShows: 0, wins: 0, losses: 0 };

/** The line under a name: "Played 14 · 1 no-show", "Played 12 · 0 no-shows", or "New to Ball Boi". */
export function reliabilityLine(r: Pick<Reliability, "played" | "noShows">): string {
  if (r.played === 0 && r.noShows === 0) return "New to Ball Boi";
  return `Played ${r.played} · ${r.noShows} no-show${r.noShows === 1 ? "" : "s"}`;
}

/** The same, for VoiceOver: "played 14, 1 no-show". */
export function reliabilitySpoken(r: Pick<Reliability, "played" | "noShows">): string {
  if (r.played === 0 && r.noShows === 0) return "new to Ball Boi";
  return `played ${r.played}, ${r.noShows} no-show${r.noShows === 1 ? "" : "s"}`;
}

export interface ScoredMatch {
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  winnerId: number | null;
}

/**
 * Played, wins and losses for one account from its scored matches. `owner`
 * maps player ids to accounts (null for a placeholder with no account). A
 * match counts when the account is on one side and at least one player on
 * the other side has an account that isn't theirs.
 */
export function countPlayed(account: string, matches: ScoredMatch[], owner: (playerId: number) => string | null): Omit<Reliability, "noShows"> {
  let played = 0;
  let wins = 0;
  let losses = 0;
  for (const m of matches) {
    const team1 = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
    const team2 = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
    const onTeam1 = team1.some((id) => owner(id) === account);
    const onTeam2 = team2.some((id) => owner(id) === account);
    if (onTeam1 === onTeam2) continue;
    const them = onTeam1 ? team2 : team1;
    if (!them.some((id) => { const o = owner(id); return o != null && o !== account; })) continue;
    played++;
    if (m.winnerId == null) continue;
    const team1Won = m.winnerId === m.player1Id || m.winnerId === m.player3Id;
    if (team1Won === onTeam1) wins++;
    else losses++;
  }
  return { played, wins, losses };
}
