import {
  playerAvatarUrl,
  playerDisplayName,
  playerLevelValue,
  playerProfileLevel,
  type ProfileMap,
} from "./playerProfile.js";

// "Who's in" on the join screen (Wave 2 finding 34, John, Nov 12): everyone
// in the league, so a player can see who they'd be playing before they join.
// - Every active member shows, whatever their Discover setting: being in a
//   league isn't the same as being findable in Discover (John, 2:09 PM).
// - Anyone with a block with the viewer, either way, stays off (John, 2:12 PM).
// - The organizer (the league's creator, who is always its owner) is marked
//   and listed first; everyone else by name.
// - Players who left, and the viewer's own row, aren't listed.

export type InviteMember = {
  playerId: number;
  name: string;
  photoUrl: string | null;
  level: number;
  levelSource: "self" | "verified";
  organizer: boolean;
};

type MemberRow = {
  id: number;
  name: string;
  clerkUserId: string | null;
  skillLevel: string | null;
  leftAt?: Date | string | null;
};

export function inviteMembers(input: {
  players: MemberRow[];
  profiles: ProfileMap;
  /** Accounts with a block with the viewer, either direction. */
  blocked: Set<string>;
  organizerClerkUserId: string | null;
  viewerClerkUserId: string | null;
}): InviteMember[] {
  const { players, profiles, blocked, organizerClerkUserId, viewerClerkUserId } = input;
  return players
    .filter((p) => !p.leftAt)
    .filter((p) => !p.clerkUserId || (p.clerkUserId !== viewerClerkUserId && !blocked.has(p.clerkUserId)))
    .map((p) => ({
      playerId: p.id,
      name: playerDisplayName(p, profiles),
      photoUrl: playerAvatarUrl(p, profiles),
      level: playerLevelValue(p, profiles),
      levelSource: playerProfileLevel(p, profiles)?.source ?? ("self" as const),
      organizer: !!p.clerkUserId && p.clerkUserId === organizerClerkUserId,
    }))
    .sort((a, b) => (a.organizer === b.organizer ? a.name.localeCompare(b.name) : a.organizer ? -1 : 1));
}
