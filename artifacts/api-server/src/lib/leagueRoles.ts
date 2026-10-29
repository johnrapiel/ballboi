// Who can do what in a league (spec: Roles and onboarding). Admin is a role on
// one league: the creator is the owner, and any admin can promote a member to
// co-admin. Pure rules, so they're easy to test.

export type LeagueRole = "owner" | "co_admin";

export function isLeagueAdminRole(role: LeagueRole | null | undefined): role is LeagueRole {
  return role === "owner" || role === "co_admin";
}

/**
 * Whether `actor` may remove `target`'s admin role. Returns a plain-English
 * problem, or null when it's allowed. The owner stays the owner; a co-admin
 * can step down; only the owner removes another co-admin.
 */
export function removeAdminProblem(input: {
  actorUserId: string;
  actorRole: LeagueRole | null;
  targetUserId: string;
  targetRole: LeagueRole | null;
}): string | null {
  if (!input.targetRole) return "That person isn't an admin of this league";
  if (input.targetRole === "owner") return "The league's creator is always an admin";
  if (input.actorUserId === input.targetUserId) return null;
  if (input.actorRole !== "owner") return "Only the league's creator can remove another admin";
  return null;
}

/** Whether a league member can be promoted to co-admin. */
export function promoteProblem(input: {
  member: { clerkUserId: string | null; leftAt: Date | null } | undefined;
  existingRole: LeagueRole | null;
}): string | null {
  if (!input.member) return "That player isn't in this league";
  if (input.member.leftAt) return "That player has left this league";
  if (!input.member.clerkUserId) return "That player needs a Ball Boi account to be an admin";
  if (input.existingRole) return "That player is already an admin";
  return null;
}
