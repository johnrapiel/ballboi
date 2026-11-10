// The doubles match chat (D6, John, Nov 9): Message on a doubles league match
// opens one group chat for all four ("You, Sam, Jo and Lee · Week 3") on the
// messaging service, like open match chats. It holds the day-before and "Did
// it happen?" cards, and goes read only once the score is in. Pairing never
// puts two players with a block in one match (D5), and the messaging service
// hides messages across a block made later.

import {
  db,
  leagueMatchChatCardsTable,
  leagueRoundsTable,
  leaguesTable,
  matchesTable,
  playersTable,
  type Match,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { addDays, leagueZone, localDate, localHour } from "../lib/leagueCalendar.js";
import { loadProfiles, playerDisplayName } from "../lib/playerProfile.js";
import { logger } from "../lib/logger.js";

/** Loaded when first needed, so the weekly loop doesn't pull the whole messaging service in with it. */
const messaging = async () => (await import("../messaging/index.js")).getMessagingService();
import {
  CHAT_CANCELLED,
  CHAT_SCORED,
  chatCardText,
  chatTitleFor,
  dueChatCards,
  type ChatCard,
} from "../lib/doublesTeams.js";

export class DoublesChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const isDoublesMatch = (m: Pick<Match, "player3Id" | "player4Id">) => m.player3Id != null && m.player4Id != null;

/** Each linked account in the match, with the others in order: partner first, then the other team. */
export function chatMembers(m: Pick<Match, "player1Id" | "player2Id" | "player3Id" | "player4Id">, accounts: Map<number, { clerkUserId: string | null; name: string }>) {
  const side1 = [m.player1Id, m.player3Id!];
  const side2 = [m.player2Id, m.player4Id!];
  const members: string[] = [];
  const titles: Record<string, string> = {};
  for (const [mine, theirs] of [[side1, side2], [side2, side1]] as const) {
    for (const me of mine) {
      const clerk = accounts.get(me)?.clerkUserId;
      if (!clerk) continue;
      members.push(clerk);
      const others = [...mine.filter((id) => id !== me), ...theirs].map((id) => accounts.get(id)?.name ?? "Player");
      titles[clerk] = others.join("\u0000");
    }
  }
  return { members, titles };
}

async function load(matchId: number) {
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!match || !match.leagueId || !isDoublesMatch(match)) return null;
  const [[league], [round], players] = await Promise.all([
    db.select().from(leaguesTable).where(eq(leaguesTable.id, match.leagueId)),
    match.roundId ? db.select().from(leagueRoundsTable).where(eq(leagueRoundsTable.id, match.roundId)) : Promise.resolve([]),
    db
      .select()
      .from(playersTable)
      .where(inArray(playersTable.id, [match.player1Id, match.player2Id, match.player3Id!, match.player4Id!])),
  ]);
  const profiles = await loadProfiles(players.map((p) => p.clerkUserId));
  const accounts = new Map(players.map((p) => [p.id, { clerkUserId: p.clerkUserId, name: playerDisplayName(p, profiles) }]));
  return { match, league: league ?? null, round: round ?? null, accounts };
}

/** Brings a doubles match's chat in step with the match. Never throws: a chat problem never undoes a score. */
export async function syncDoublesMatchChat(matchId: number, opts: { create?: boolean; system?: string } = {}): Promise<number | null> {
  try {
    const loaded = await load(matchId);
    if (!loaded) return null;
    const { match, round, accounts } = loaded;
    const { members, titles: raw } = chatMembers(match, accounts);
    const week = round?.roundNumber ?? null;
    const titles = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, chatTitleFor(v.split("\u0000"), week)]));
    const scored = match.status === "completed";
    const voided = !!match.voidedAt;
    const group = await (await messaging()).syncMatchGroup({
      matchId,
      title: week ? `Doubles · Week ${week}` : "Doubles",
      titles,
      members,
      open: !scored && !voided,
      closedReason: voided ? CHAT_CANCELLED : scored ? CHAT_SCORED : null,
      system: opts.system,
      create: opts.create,
    });
    return group?.id ?? null;
  } catch (err) {
    logger.error({ err, matchId }, "Doubles match chat update failed");
    return null;
  }
}

/** Message on a doubles match: the four players' chat, made now if it isn't yet. */
export async function openDoublesMatchChat(leagueId: number, matchId: number, userId: string): Promise<{ groupId: number }> {
  const loaded = await load(matchId);
  if (!loaded || loaded.match.leagueId !== leagueId) throw new DoublesChatError(404, "Match not found");
  if (!loaded.round?.publishedAt) throw new DoublesChatError(404, "Match not found");
  const mine = [...loaded.accounts.values()].some((a) => a.clerkUserId === userId);
  if (!mine) throw new DoublesChatError(403, "Only the four players in this match can open its chat.");
  const existing = await (await messaging()).groupForMatch(matchId);
  const groupId = await syncDoublesMatchChat(matchId, {
    create: true,
    ...(existing ? {} : { system: `Week ${loaded.round.roundNumber} pairings are out. Work out a time here.` }),
  });
  if (!groupId) throw new DoublesChatError(500, "The chat didn't open. Try again.");
  return { groupId };
}

/** A round went out: each doubles match gets its chat, with a first line so it shows in Messages. */
export async function openChatsForRound(roundId: number, roundNumber: number): Promise<void> {
  const matches = await db
    .select({ id: matchesTable.id, player3Id: matchesTable.player3Id, player4Id: matchesTable.player4Id })
    .from(matchesTable)
    .where(and(eq(matchesTable.roundId, roundId), isNull(matchesTable.voidedAt)));
  for (const m of matches.filter(isDoublesMatch)) {
    await syncDoublesMatchChat(m.id, { create: true, system: `Week ${roundNumber} pairings are out. Work out a time here.` });
  }
}

/** The score is in (or edited): the chat says so and goes read only. */
export function closeChatForScore(matchId: number, line?: string): void {
  void syncDoublesMatchChat(matchId, line ? { system: line } : {});
}

/** Matches cancelled (a dropout or a split): their chats go read only. */
export function closeChatsForVoided(matchIds: number[]): void {
  for (const id of matchIds) void syncDoublesMatchChat(id);
}

/**
 * Hourly: the day-before and "Did it happen?" cards in each published doubles
 * match's chat, each at most once (claimed in league_match_chat_cards first).
 */
export async function runDoublesChatCards(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: matchesTable.id,
      scheduledAt: matchesTable.scheduledAt,
      status: matchesTable.status,
      timeZone: leaguesTable.timeZone,
      publishedAt: leagueRoundsTable.publishedAt,
    })
    .from(matchesTable)
    .innerJoin(leaguesTable, eq(leaguesTable.id, matchesTable.leagueId))
    .innerJoin(leagueRoundsTable, eq(leagueRoundsTable.id, matchesTable.roundId))
    .where(and(
      eq(leaguesTable.leagueType, "doubles"),
      isNotNull(matchesTable.scheduledAt),
      isNotNull(matchesTable.player3Id),
      isNull(matchesTable.voidedAt),
      ne(matchesTable.status, "completed"),
    ));
  let sent = 0;
  for (const m of rows) {
    if (!m.publishedAt || !m.scheduledAt) continue;
    const at = new Date(m.scheduledAt);
    const zone = leagueZone({ timeZone: m.timeZone });
    const due = dueChatCards({ scheduledAt: at, scored: m.status === "completed" }, zone, now, { date: localDate, hour: localHour, addDays });
    for (const card of due) {
      if (!(await claim(m.id, card, now))) continue;
      await syncDoublesMatchChat(m.id, { create: true });
      await (await messaging()).postToMatch(m.id, chatCardText(card, at, zone)).catch((err) => logger.warn({ err, matchId: m.id }, "Doubles chat card failed"));
      sent++;
    }
  }
  return sent;
}

async function claim(matchId: number, kind: ChatCard, at: Date): Promise<boolean> {
  const rows = await db
    .insert(leagueMatchChatCardsTable)
    .values({ matchId, kind, sentAt: at })
    .onConflictDoNothing()
    .returning({ matchId: leagueMatchChatCardsTable.matchId });
  return rows.length > 0;
}
