// League chats (decisions 145 and 146): keeps each league's chat in step with
// the league. Every league gets one chat on the messaging service, listed in
// Messages with every other chat and titled with the league name.
//
// - Members are the league's current players and admins. Joining adds you;
//   leaving or being removed takes you out. An admin who stops playing still
//   runs the league (Q4), so they stay.
// - An ended league's chat stays readable but takes no new messages. Doubles
//   leagues and leagues on hold get a chat like any other.
// - Ball Boi posts when pairings go out, a result is entered or edited, and
//   the standings change. These never push or count on the Messages button.
// - Existing leagues get their chat from syncAll at startup, or the first
//   time anyone opens it from the league page. Nothing is ever deleted.

import { pairingsPost, resultPost, standingsPost, standingsSnapshot, type StandingRow } from "../lib/leagueChatPosts.js";
import type { LeagueChatEvents } from "./leagueChatEvents";
import type { MessagingService } from "./service";

export interface LeagueChatLeague {
  id: number;
  name: string;
  ended: boolean;
}

export interface LeagueChatMember {
  userId: string;
  admin: boolean;
  /** Their player in this league, when they play in it. */
  playerId: number | null;
}

export interface LeagueChatResult {
  winners: string[];
  losers: string[];
  /** From the winners' side. */
  score: string | null;
  /** Counts toward standings (not grace week, not playoffs, not voided). */
  counts: boolean;
}

/** Everything LeagueChats reads about leagues. Postgres in the app, memory in tests. */
export interface LeagueChatSource {
  league(leagueId: number): Promise<LeagueChatLeague | null>;
  members(leagueId: number): Promise<LeagueChatMember[]>;
  allLeagueIds(): Promise<number[]>;
  result(leagueId: number, matchId: number): Promise<LeagueChatResult | null>;
  standings(leagueId: number): Promise<StandingRow[]>;
}

type Log = { warn: (o: object, m: string) => void; info?: (o: object, m: string) => void };

export class LeagueChats {
  constructor(
    private deps: {
      service: () => MessagingService;
      source: LeagueChatSource;
      log: Log;
    },
  ) {}

  private get svc() {
    return this.deps.service();
  }

  /** Brings a league's chat in step with the league, making it if needed. A deleted league's chat empties out. */
  async sync(leagueId: number) {
    const league = await this.deps.source.league(leagueId);
    if (!league) {
      const group = await this.svc.groupForLeague(leagueId);
      if (!group) return null;
      return this.svc.syncLeagueGroup({ leagueId, title: group.title, members: [], ended: true });
    }
    const members = await this.deps.source.members(leagueId);
    const group = await this.svc.syncLeagueGroup({
      leagueId,
      title: league.name,
      members: members.map(({ userId, admin }) => ({ userId, admin })),
      ended: league.ended,
    });
    // A new chat notes today's standings, so the next result can say who moved up.
    if (group && !group.standings) {
      const standings = standingsSnapshot(await this.deps.source.standings(leagueId));
      await this.svc.setLeagueStandings(group.id, standings);
      return { ...group, standings };
    }
    return group;
  }

  /**
   * Startup: every league's chat, so existing leagues have one. Idempotent.
   * Also chats whose league was deleted outside the app (the demo seed deletes
   * its leagues directly), so they empty out and close instead of showing in
   * Messages next to the new league's chat with the same name (Wave 2 finding 2).
   */
  async syncAll(): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;
    const [leagues, chatted] = await Promise.all([this.deps.source.allLeagueIds(), this.svc.repo.leagueIdsWithGroups()]);
    for (const id of new Set([...leagues, ...chatted])) {
      try {
        await this.sync(id);
        synced += 1;
      } catch (err) {
        failed += 1;
        this.deps.log.warn({ err, leagueId: id }, "League chat sync failed");
      }
    }
    return { synced, failed };
  }

  /** For the league page's Chat button: your league's chat, made now if it's missing. */
  async chatFor(leagueId: number, me: string): Promise<{ groupId: number; unread: number; attention: number } | null> {
    const group = (await this.svc.groupForLeague(leagueId)) ?? (await this.sync(leagueId));
    if (!group) return null;
    let members = await this.svc.repo.groupMembers(group.id);
    // Not in it yet (a join this chat missed): bring it in step once.
    if (!members.some((m) => m.userId === me)) {
      await this.sync(leagueId);
      members = await this.svc.repo.groupMembers(group.id);
    }
    const mine = members.find((m) => m.userId === me);
    if (!mine) return null;
    return { groupId: group.id, unread: mine.unread, attention: mine.attention };
  }

  async roundPublished(leagueId: number, roundNumber: number) {
    await this.post(leagueId, pairingsPost(roundNumber));
  }

  async resultEntered(leagueId: number, matchId: number, opts: { edited?: boolean } = {}) {
    const result = await this.deps.source.result(leagueId, matchId);
    if (!result) return;
    const group = await this.post(leagueId, resultPost({ ...result, edited: opts.edited }));
    if (!group || !result.counts) return;
    await this.standingsChanged(leagueId);
  }

  /** Posts who moved up since the chat last looked, then remembers the new standings. */
  async standingsChanged(leagueId: number) {
    const group = await this.svc.groupForLeague(leagueId);
    if (!group) return;
    const rows = await this.deps.source.standings(leagueId);
    const line = standingsPost(group.standings, rows);
    if (line) await this.svc.postToLeague(leagueId, line);
    await this.svc.setLeagueStandings(group.id, standingsSnapshot(rows));
  }

  async removedFromChat(leagueId: number, admin: string, removed: string) {
    await this.svc.logLeagueRemoval(admin, leagueId, removed);
  }

  /** Each account's player id in the league, for Remove from league in the chat. */
  async leaguePlayers(leagueId: number): Promise<Map<string, number>> {
    const members = await this.deps.source.members(leagueId);
    return new Map(members.filter((m) => m.playerId !== null).map((m) => [m.userId, m.playerId!]));
  }

  /** Posts in the league's chat, making it first if it's missing. */
  private async post(leagueId: number, text: string) {
    const group = (await this.svc.groupForLeague(leagueId)) ?? (await this.sync(leagueId));
    if (!group) return null;
    return this.svc.postToLeague(leagueId, text);
  }

  /** The fire-and-forget version the routes call (leagueChatEvents.ts). */
  events(): LeagueChatEvents {
    const run = (what: string, leagueId: number, fn: () => Promise<unknown>) => {
      void fn().catch((err) => this.deps.log.warn({ err, leagueId }, `League chat: ${what} failed`));
    };
    return {
      leagueChanged: (leagueId) => run("sync", leagueId, () => this.sync(leagueId)),
      roundPublished: (leagueId, n) => run("pairings post", leagueId, () => this.roundPublished(leagueId, n)),
      resultEntered: (leagueId, matchId, opts) => run("result post", leagueId, () => this.resultEntered(leagueId, matchId, opts)),
      removedFromChat: (leagueId, admin, removed) => run("removal log", leagueId, () => this.removedFromChat(leagueId, admin, removed)),
    };
  }
}
