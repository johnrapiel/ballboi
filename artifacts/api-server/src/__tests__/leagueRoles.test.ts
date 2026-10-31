import { describe, it, expect } from "vitest";
import { isLeagueAdminRole, promoteProblem, removeAdminProblem } from "../lib/leagueRoles.js";

// Spec: Roles and onboarding. Admin is a role on one league; co-admins are
// promoted from members; the creator stays the owner.

describe("isLeagueAdminRole", () => {
  it("treats owners and co-admins as admins, nobody else", () => {
    expect(isLeagueAdminRole("owner")).toBe(true);
    expect(isLeagueAdminRole("co_admin")).toBe(true);
    expect(isLeagueAdminRole(null)).toBe(false);
  });
});

describe("promoteProblem", () => {
  const member = { clerkUserId: "user_b", leftAt: null };

  it("allows promoting an active member with an account", () => {
    expect(promoteProblem({ member, existingRole: null })).toBeNull();
  });

  it("refuses someone outside the league", () => {
    expect(promoteProblem({ member: undefined, existingRole: null })).toMatch(/isn't in this league/);
  });

  it("refuses a player who dropped out", () => {
    expect(promoteProblem({ member: { ...member, leftAt: new Date() }, existingRole: null })).toMatch(/left/);
  });

  it("refuses a player added by name without an account", () => {
    expect(promoteProblem({ member: { clerkUserId: null, leftAt: null }, existingRole: null })).toMatch(/account/);
  });

  it("refuses someone who's already an admin", () => {
    expect(promoteProblem({ member, existingRole: "co_admin" })).toMatch(/already an admin/);
  });
});

describe("removeAdminProblem", () => {
  it("never removes the owner", () => {
    expect(
      removeAdminProblem({ actorUserId: "owner", actorRole: "owner", targetUserId: "owner", targetRole: "owner" }),
    ).toMatch(/always an admin/);
  });

  it("lets a co-admin step down", () => {
    expect(
      removeAdminProblem({ actorUserId: "co", actorRole: "co_admin", targetUserId: "co", targetRole: "co_admin" }),
    ).toBeNull();
  });

  it("lets the owner remove a co-admin", () => {
    expect(
      removeAdminProblem({ actorUserId: "owner", actorRole: "owner", targetUserId: "co", targetRole: "co_admin" }),
    ).toBeNull();
  });

  it("stops one co-admin removing another", () => {
    expect(
      removeAdminProblem({ actorUserId: "co1", actorRole: "co_admin", targetUserId: "co2", targetRole: "co_admin" }),
    ).toMatch(/Only the league's creator/);
  });

  it("reports when the target isn't an admin", () => {
    expect(
      removeAdminProblem({ actorUserId: "owner", actorRole: "owner", targetUserId: "x", targetRole: null }),
    ).toMatch(/isn't an admin/);
  });
});
