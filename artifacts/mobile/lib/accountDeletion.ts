// Delete account (App Store 5.1.1(v)): handing over leagues the person runs
// alone (Wave 1 review S4, John's call). They pick who takes over each one,
// or skip, and the server gives it to the longest-standing member.
// Deletion is never blocked by this.

import { apiErrorMessage, apiFetch, type TokenGetter } from "@/lib/api";

export interface HandoffMember {
  playerId: number;
  name: string;
  joinedAt: string;
}

export interface HandoffLeague {
  leagueId: number;
  name: string;
  /** Who could take over, longest-standing first. */
  members: HandoffMember[];
}

/** Active leagues the person runs alone that someone could take over. */
export async function fetchLeagueHandoff(getToken: TokenGetter): Promise<HandoffLeague[]> {
  const res = await apiFetch("/api/users/me/league-handoff", getToken);
  if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't load your leagues."));
  const body = (await res.json()) as { leagues?: HandoffLeague[] };
  return body.leagues ?? [];
}

/** A league ID to the player picked to run it, or null when they skipped. */
export type HandoffPicks = Record<number, number | null>;

/** The `newAdmins` list for DELETE /users/me. Skipped leagues are left out. */
export function newAdminsPayload(picks: HandoffPicks): { leagueId: number; playerId: number }[] {
  return Object.entries(picks)
    .filter((entry): entry is [string, number] => entry[1] != null)
    .map(([leagueId, playerId]) => ({ leagueId: Number(leagueId), playerId }));
}

/** Who takes over when the person skips: the longest-standing member. */
export function skipSuccessor(league: HandoffLeague): HandoffMember | null {
  return league.members[0] ?? null;
}

export async function deleteMyAccount(getToken: TokenGetter, picks: HandoffPicks) {
  return apiFetch("/api/users/me", getToken, {
    method: "DELETE",
    body: JSON.stringify({ confirm: "DELETE", newAdmins: newAdminsPayload(picks) }),
  });
}
