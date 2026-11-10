import { describe, it, expect, vi } from "vitest";
import type { Row } from "./fakeDb";

// App Store 5.1.1(v): deleting an account removes the doubles partner data it
// created (waves.md: each feature's own helper).

const { rows } = vi.hoisted(() => ({ rows: {} as Record<string, Row[]> }));
vi.mock("@workspace/db", async () => {
  const { fakeDb, table } = await import("./fakeDb");
  return {
    db: fakeDb(rows),
    leaguePartnerRequestsTable: table("league_partner_requests", ["id", "fromPlayerId", "toPlayerId"]),
    leagueTeamsTable: table("league_teams", ["id", "player1Id", "player2Id", "dissolvedAt", "dissolvedReason"]),
    playersTable: table("players", ["id", "lookingForPartnerAt"]),
  };
});
vi.mock("drizzle-orm", async () => (await import("./fakeDb")).drizzleFake);

import { db } from "@workspace/db";
import { deleteDoublesDataFor } from "../lib/doublesAccountDeletion";

describe("deleteDoublesDataFor", () => {
  it("removes their requests, breaks up their active team (partner needs a partner, D4) and clears the list flag", async () => {
    const at = new Date("2026-11-10T12:00:00Z");
    rows.league_partner_requests = [
      { id: 1, fromPlayerId: 7, toPlayerId: 2 },
      { id: 2, fromPlayerId: 3, toPlayerId: 7 },
      { id: 3, fromPlayerId: 3, toPlayerId: 4 },
    ];
    rows.league_teams = [
      { id: 10, player1Id: 7, player2Id: 2, dissolvedAt: null, dissolvedReason: null },
      { id: 11, player1Id: 3, player2Id: 4, dissolvedAt: null, dissolvedReason: null },
    ];
    rows.players = [{ id: 7, lookingForPartnerAt: at }, { id: 3, lookingForPartnerAt: at }];
    await db.transaction((tx) => deleteDoublesDataFor(tx as never, [7], at));
    expect(rows.league_partner_requests.map((r) => r.id)).toEqual([3]);
    expect(rows.league_teams.map((t) => [t.id, t.dissolvedReason])).toEqual([
      [10, "partner_left"],
      [11, null],
    ]);
    expect(rows.players.map((p) => p.lookingForPartnerAt)).toEqual([null, at]);
  });

  it("does nothing without player rows", async () => {
    rows.league_teams = [{ id: 10, player1Id: 7, player2Id: 2, dissolvedAt: null, dissolvedReason: null }];
    await deleteDoublesDataFor(db as never, []);
    expect(rows.league_teams[0].dissolvedAt).toBeNull();
  });
});
