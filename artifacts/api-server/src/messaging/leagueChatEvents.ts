// What the league routes tell the league chat (decision 145). Routes call
// these and move on: the chat never holds up joining, leaving, scores or
// pairings, and a failure is logged, not shown.
//
// Until the API starts (index.ts installs LeagueChats), these do nothing, so
// route tests that never touch messaging stay as they are.

export interface LeagueChatEvents {
  /** Someone joined, left, was removed, became or stopped being an admin, or the league was renamed, ended or deleted. */
  leagueChanged(leagueId: number): void;
  /** A round's pairings went out. */
  roundPublished(leagueId: number, roundNumber: number): void;
  /** A result was entered, edited or corrected. Posts it, then any standings moves. */
  resultEntered(leagueId: number, matchId: number, opts?: { edited?: boolean }): void;
  /** An admin removed someone from the league from its chat: logged to the moderation queue. */
  removedFromChat(leagueId: number, adminUserId: string, removedUserId: string): void;
}

const NONE: LeagueChatEvents = {
  leagueChanged: () => undefined,
  roundPublished: () => undefined,
  resultEntered: () => undefined,
  removedFromChat: () => undefined,
};

let current: LeagueChatEvents = NONE;

export function setLeagueChatEvents(next: LeagueChatEvents | null): void {
  current = next ?? NONE;
}

export const leagueChat: LeagueChatEvents = {
  leagueChanged: (leagueId) => current.leagueChanged(leagueId),
  roundPublished: (leagueId, roundNumber) => current.roundPublished(leagueId, roundNumber),
  resultEntered: (leagueId, matchId, opts) => current.resultEntered(leagueId, matchId, opts),
  removedFromChat: (leagueId, admin, removed) => current.removedFromChat(leagueId, admin, removed),
};
