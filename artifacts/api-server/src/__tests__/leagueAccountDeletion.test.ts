import { describe, it, expect, vi } from "vitest";

// App Store 5.1.1(v): deleting an account removes the league data it created.

vi.mock("@workspace/db", () => ({
  leagueAdminsTable: { __name: "league_admins", clerkUserId: "league_admins.clerk_user_id" },
  leagueJoinRequestsTable: { __name: "league_join_requests", clerkUserId: "league_join_requests.clerk_user_id" },
  leaguesTable: { __name: "leagues", createdByClerkUserId: "leagues.created_by" },
}));
vi.mock("drizzle-orm", () => ({ eq: (a: unknown, b: unknown) => ({ a, b }) }));

import { deleteLeagueDataFor } from "../lib/leagueAccountDeletion.js";

describe("deleteLeagueDataFor", () => {
  it("removes admin roles and join requests, and unlinks leagues they created", async () => {
    const calls: string[] = [];
    const tx = {
      delete: (t: { __name: string }) => ({ where: async (c: unknown) => void calls.push(`delete ${t.__name} ${JSON.stringify(c)}`) }),
      update: (t: { __name: string }) => ({
        set: (v: object) => ({ where: async (c: unknown) => void calls.push(`update ${t.__name} ${JSON.stringify(v)} ${JSON.stringify(c)}`) }),
      }),
    };
    await deleteLeagueDataFor(tx as never, "user_x");
    expect(calls).toEqual([
      'delete league_admins {"a":"league_admins.clerk_user_id","b":"user_x"}',
      'delete league_join_requests {"a":"league_join_requests.clerk_user_id","b":"user_x"}',
      'update leagues {"createdByClerkUserId":null} {"a":"leagues.created_by","b":"user_x"}',
    ]);
  });
});
