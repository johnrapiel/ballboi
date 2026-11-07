// Database reads for player search. The rules live in playerSearch.ts.

import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { blockedAccountsFor } from "./blocks.js";
import { likePattern, RESPECT_HIDDEN_PROFILE, type ConnectedCandidate, type SearchCandidate } from "./playerSearch.js";

export interface PlayerSearchRepo {
  /** League mates and past opponents with an account. Blocks are applied by the caller. */
  connected(me: string): Promise<ConnectedCandidate[]>;
  /** Findable accounts whose name has every word of `query`, by name, at most `limit`. */
  findable(me: string, query: string, limit: number): Promise<SearchCandidate[]>;
  /** One findable account by users.id, or null. */
  findableUser(me: string, userId: number): Promise<SearchCandidate | null>;
  /** Accounts blocked either way. */
  blocked(me: string): Promise<Set<string>>;
}

/** The player row to use for an account: the league-free one if any, else the first. */
const preferredPlayerId = (clerkUserIdColumn: SQL) => sql`(
  SELECT p.id FROM players p WHERE p.clerk_user_id = ${clerkUserIdColumn}
  ORDER BY (p.league_id IS NOT NULL), p.id LIMIT 1)`;

/** See RESPECT_HIDDEN_PROFILE in playerSearch.ts: switch it on when #117 adds users.discover_hidden. */
const hiddenProfileFilter = (): SQL => (RESPECT_HIDDEN_PROFILE ? sql`AND u.discover_hidden = false` : sql``);

/**
 * Findable: finished onboarding, not you, not blocked either way, not banned
 * or suspended right now, and (once #117 lands) not hidden.
 */
const findableWhere = (me: string): SQL => sql`
  u.onboarding_complete = true
  AND u.clerk_user_id <> ${me}
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_clerk_user_id = ${me} AND b.blocked_clerk_user_id = u.clerk_user_id)
       OR (b.blocker_clerk_user_id = u.clerk_user_id AND b.blocked_clerk_user_id = ${me}))
  AND NOT EXISTS (
    SELECT 1 FROM account_sanctions s
    WHERE s.clerk_user_id = u.clerk_user_id AND s.lifted_at IS NULL
      AND (s.ends_at IS NULL OR s.ends_at > now()))
  ${hiddenProfileFilter()}`;

type StrangerRow = { clerk_user_id: string; user_id: number; player_id: number | null; name: string; avatar_url: string | null };

const toCandidate = (r: StrangerRow): SearchCandidate => ({
  clerkUserId: r.clerk_user_id,
  userId: Number(r.user_id),
  playerId: r.player_id == null ? null : Number(r.player_id),
  name: r.name,
  avatarUrl: r.avatar_url,
});

export class DrizzlePlayerSearchRepo implements PlayerSearchRepo {
  async connected(me: string): Promise<ConnectedCandidate[]> {
    const result = await db.execute(sql`
      WITH mine AS (SELECT id, league_id FROM players WHERE clerk_user_id = ${me}),
      mates AS (
        SELECT DISTINCT p.clerk_user_id FROM players p
        JOIN mine ON mine.league_id IS NOT NULL AND p.league_id = mine.league_id
        WHERE p.clerk_user_id IS NOT NULL),
      opponent_rows AS (
        SELECT unnest(ARRAY[m.player1_id, m.player2_id, m.player3_id, m.player4_id]) AS player_id
        FROM matches m
        WHERE m.player1_id IN (SELECT id FROM mine) OR m.player2_id IN (SELECT id FROM mine)
           OR m.player3_id IN (SELECT id FROM mine) OR m.player4_id IN (SELECT id FROM mine)),
      played AS (
        SELECT DISTINCT p.clerk_user_id FROM players p
        JOIN opponent_rows o ON o.player_id = p.id
        WHERE p.clerk_user_id IS NOT NULL),
      people AS (SELECT clerk_user_id FROM mates UNION SELECT clerk_user_id FROM played)
      SELECT pe.clerk_user_id, u.id AS user_id, u.avatar_url,
        COALESCE(NULLIF(u.display_name, ''),
          (SELECT p.name FROM players p WHERE p.clerk_user_id = pe.clerk_user_id ORDER BY p.id LIMIT 1)) AS name,
        ${preferredPlayerId(sql`pe.clerk_user_id`)} AS player_id,
        pe.clerk_user_id IN (SELECT clerk_user_id FROM mates) AS in_your_leagues,
        pe.clerk_user_id IN (SELECT clerk_user_id FROM played) AS played_before
      FROM people pe
      LEFT JOIN users u ON u.clerk_user_id = pe.clerk_user_id
      WHERE pe.clerk_user_id <> ${me}`);
    return (
      result.rows as {
        clerk_user_id: string;
        user_id: number | null;
        avatar_url: string | null;
        name: string;
        player_id: number | null;
        in_your_leagues: boolean;
        played_before: boolean;
      }[]
    ).map((r) => ({
      clerkUserId: r.clerk_user_id,
      userId: r.user_id == null ? null : Number(r.user_id),
      playerId: r.player_id == null ? null : Number(r.player_id),
      name: r.name,
      avatarUrl: r.avatar_url,
      inYourLeagues: !!r.in_your_leagues,
      playedBefore: !!r.played_before,
    }));
  }

  async findable(me: string, query: string, limit: number): Promise<SearchCandidate[]> {
    const words = query ? query.split(" ") : [];
    const nameFilter = words.length
      ? sql.join(
          words.map((w) => sql`AND u.display_name ILIKE ${likePattern(w)}`),
          sql` `,
        )
      : sql``;
    const result = await db.execute(sql`
      SELECT u.clerk_user_id, u.id AS user_id, u.display_name AS name, u.avatar_url,
        ${preferredPlayerId(sql`u.clerk_user_id`)} AS player_id
      FROM users u
      WHERE ${findableWhere(me)} ${nameFilter}
      ORDER BY u.display_name, u.id
      LIMIT ${limit}`);
    return (result.rows as StrangerRow[]).map(toCandidate);
  }

  async findableUser(me: string, userId: number): Promise<SearchCandidate | null> {
    const result = await db.execute(sql`
      SELECT u.clerk_user_id, u.id AS user_id, u.display_name AS name, u.avatar_url,
        ${preferredPlayerId(sql`u.clerk_user_id`)} AS player_id
      FROM users u
      WHERE u.id = ${userId} AND ${findableWhere(me)}`);
    const row = (result.rows as StrangerRow[])[0];
    return row ? toCandidate(row) : null;
  }

  blocked(me: string): Promise<Set<string>> {
    return blockedAccountsFor(me);
  }
}

