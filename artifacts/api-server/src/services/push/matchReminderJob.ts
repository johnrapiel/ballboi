// Runs the match day reminder rule (lib/matchReminders.ts) every 5 minutes.
// Each reminder is claimed in match_reminders_log before the push goes out,
// so it's sent at most once however often this runs.

import {
  db,
  leagueRoundsTable,
  leaguesTable,
  matchPlansTable,
  matchRemindersLogTable,
  matchesTable,
  notificationSettingsTable,
  playersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { DEFAULT_LEAGUE_TIME_ZONE, leagueZone } from "../../lib/leagueCalendar";
import { logger } from "../../lib/logger";
import {
  dueForTimedMatch,
  nudgeSunday,
  reminderCopy,
  remindedUserIds,
  wantsWeekNudge,
  type DueReminder,
  type ReminderType,
} from "../../lib/matchReminders";

type Push = (userIds: string[], title: string, body: string, link: string) => Promise<void>;
type MatchRow = typeof matchesTable.$inferSelect;
type PlayerRow = typeof playersTable.$inferSelect;

/** Looks this far ahead for matches with a set time: past tomorrow's last hour on any clock. */
const LOOKAHEAD_MS = 50 * 60 * 60 * 1000;

async function claim(r: DueReminder): Promise<boolean> {
  const [row] = await db
    .insert(matchRemindersLogTable)
    .values({ matchId: r.matchId, reminderType: r.type, reminderForDate: r.key })
    .onConflictDoNothing({ target: [matchRemindersLogTable.matchId, matchRemindersLogTable.reminderType, matchRemindersLogTable.reminderForDate] })
    .returning({ id: matchRemindersLogTable.id });
  return !!row;
}

async function turnedOffAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: notificationSettingsTable.clerkUserId })
    .from(notificationSettingsTable)
    .where(and(inArray(notificationSettingsTable.clerkUserId, ids), eq(notificationSettingsTable.matchReminders, false)));
  return new Set(rows.map((r) => r.id));
}

async function playersOf(matches: MatchRow[]): Promise<Map<number, PlayerRow>> {
  const ids = [...new Set(matches.flatMap((m) => [m.player1Id, m.player2Id, m.player3Id, m.player4Id]).filter((id): id is number => id != null))];
  const rows = ids.length ? await db.select().from(playersTable).where(inArray(playersTable.id, ids)) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

/** Each player's own reminder names the other side: "vs Sam Whitfield", "vs Sam & Ana". */
async function sendToSides(
  match: MatchRow,
  players: Map<number, PlayerRow>,
  turnedOff: Set<string>,
  type: ReminderType,
  copy: (opponents: string) => { title: string; body: string },
  push: Push,
): Promise<number> {
  const p = (id: number | null) => (id != null ? players.get(id) ?? null : null);
  const sideA = [p(match.player1Id), p(match.player3Id)].filter((x): x is PlayerRow => !!x);
  const sideB = [p(match.player2Id), p(match.player4Id)].filter((x): x is PlayerRow => !!x);
  const names = (side: PlayerRow[]) => side.map((x) => x.name).join(" & ");
  let sent = 0;
  for (const [mine, theirs] of [
    [sideA, sideB],
    [sideB, sideA],
  ] as const) {
    const to = remindedUserIds(mine, turnedOff);
    if (!to.length) continue;
    const { title, body } = copy(names(theirs));
    await push(to, title, body, `/match/${match.id}`).catch((err) => logger.warn({ err, matchId: match.id, type }, "Reminder push failed"));
    sent += to.length;
  }
  return sent;
}

/** Day-before at 8 AM on the match's clock, and 2 hours before. */
async function timedReminders(now: Date, push: Push): Promise<number> {
  const matches = (
    await db
      .select()
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.status, "scheduled"),
          isNotNull(matchesTable.scheduledAt),
          gte(matchesTable.scheduledAt, now.toISOString()),
          lt(matchesTable.scheduledAt, new Date(now.getTime() + LOOKAHEAD_MS).toISOString()),
        ),
      )
  ).filter((m) => !m.score);
  if (!matches.length) return 0;

  const leagueIds = [...new Set(matches.map((m) => m.leagueId).filter((id): id is number => id != null))];
  const leagues = leagueIds.length ? await db.select({ id: leaguesTable.id, timeZone: leaguesTable.timeZone }).from(leaguesTable).where(inArray(leaguesTable.id, leagueIds)) : [];
  const leagueZoneOf = new Map(leagues.map((l) => [l.id, leagueZone(l)]));
  const plans = await db
    .select({ matchId: matchPlansTable.matchId, timeZone: matchPlansTable.timeZone, courtName: matchPlansTable.courtName })
    .from(matchPlansTable)
    .where(inArray(matchPlansTable.matchId, matches.map((m) => m.id)));
  const planOf = new Map(plans.map((p) => [p.matchId, p]));

  const due: { match: MatchRow; reminder: DueReminder; zone: string }[] = [];
  for (const match of matches) {
    const zone = match.leagueId != null ? leagueZoneOf.get(match.leagueId) ?? DEFAULT_LEAGUE_TIME_ZONE : planOf.get(match.id)?.timeZone ?? DEFAULT_LEAGUE_TIME_ZONE;
    const at = new Date(match.scheduledAt!);
    for (const reminder of dueForTimedMatch({ id: match.id, scheduledAt: at, timeZone: zone }, now)) due.push({ match, reminder, zone });
  }
  if (!due.length) return 0;

  const players = await playersOf(due.map((d) => d.match));
  const turnedOff = await turnedOffAmong([...new Set([...players.values()].map((p) => p.clerkUserId).filter((id): id is string => !!id))]);
  let sent = 0;
  for (const { match, reminder, zone } of due) {
    try {
      if (!(await claim(reminder))) continue;
      const place = match.location ?? planOf.get(match.id)?.courtName ?? null;
      const at = new Date(match.scheduledAt!);
      sent += await sendToSides(match, players, turnedOff, reminder.type, (opponents) => reminderCopy(reminder.type, { opponents, at, timeZone: zone, place }), push);
    } catch (err) {
      logger.error({ err, matchId: match.id, type: reminder.type }, "Match reminder failed");
    }
  }
  return sent;
}

/** Sunday 9 AM on the league's clock: league matches with no set time. */
async function weekNudges(now: Date, push: Push): Promise<number> {
  const leagues = await db.select({ id: leaguesTable.id, timeZone: leaguesTable.timeZone }).from(leaguesTable);
  const sundayOf = new Map<number, string>();
  for (const l of leagues) {
    const sunday = nudgeSunday(now, leagueZone(l));
    if (sunday) sundayOf.set(l.id, sunday);
  }
  if (!sundayOf.size) return 0;
  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.status, "scheduled"), isNull(matchesTable.scheduledAt), isNotNull(matchesTable.roundId), inArray(matchesTable.leagueId, [...sundayOf.keys()])));
  const open = matches.filter((m) => !m.score && m.roundId != null);
  if (!open.length) return 0;
  const rounds = await db
    .select({ id: leagueRoundsTable.id, startDate: leagueRoundsTable.startDate, endDate: leagueRoundsTable.endDate, publishedAt: leagueRoundsTable.publishedAt })
    .from(leagueRoundsTable)
    .where(inArray(leagueRoundsTable.id, [...new Set(open.map((m) => m.roundId!))]));
  const roundOf = new Map(rounds.map((r) => [r.id, r]));
  const due = open.filter((m) => {
    const r = roundOf.get(m.roundId!);
    const sunday = sundayOf.get(m.leagueId!);
    return !!r && !!sunday && wantsWeekNudge({ startDate: r.startDate, endDate: r.endDate, published: r.publishedAt != null }, sunday);
  });
  if (!due.length) return 0;
  const players = await playersOf(due);
  const turnedOff = await turnedOffAmong([...new Set([...players.values()].map((p) => p.clerkUserId).filter((id): id is string => !!id))]);
  let sent = 0;
  for (const match of due) {
    try {
      if (!(await claim({ matchId: match.id, type: "week_nudge", key: sundayOf.get(match.leagueId!)! }))) continue;
      const byDate = roundOf.get(match.roundId!)?.endDate ?? null;
      sent += await sendToSides(match, players, turnedOff, "week_nudge", (opponents) => reminderCopy("week_nudge", { opponents, at: null, timeZone: DEFAULT_LEAGUE_TIME_ZONE, place: null, byDate }), push);
    } catch (err) {
      logger.error({ err, matchId: match.id }, "Week nudge failed");
    }
  }
  return sent;
}

export async function runMatchReminders(now: Date, push: Push): Promise<{ timed: number; nudges: number }> {
  const timed = await timedReminders(now, push).catch((err) => {
    logger.error({ err }, "Match day reminders failed");
    return 0;
  });
  const nudges = await weekNudges(now, push).catch((err) => {
    logger.error({ err }, "Week nudges failed");
    return 0;
  });
  return { timed, nudges };
}
