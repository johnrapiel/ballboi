// What the Home tab shows from leagues (spec: Navigation > Home: upcoming
// matches, this week's pairings, recent results). Pure, so it's easy to test.

import { graceEndFor, leagueZone, roundPhase, todayFor, type RoundPhase } from "./leagueCalendar.js";
import { leagueHasEnded } from "./leagueLifecycle.js";
import { flipScore as flip } from "./tennisScore.js";

export interface HomeRound {
  id: number;
  leagueId: number;
  roundNumber: number;
  startDate: string;
  endDate: string;
  publishedAt: Date | null;
}

export interface HomeMatch {
  id: number;
  leagueId: number | null;
  roundId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  status: string;
  score: string | null;
  winnerId: number | null;
  inGrace: boolean;
  voidedAt: Date | null;
  completedAt: string | null;
  scheduledAt: string | null;
  location: string | null;
  playoffBracketId: number | null;
  playoffRound: string | null;
}

export interface HomeInput {
  /** Now, so each league's "today" follows its own time zone. */
  now: Date;
  /** The viewer's player rows, one per league. */
  myPlayers: { id: number; leagueId: number | null; leftAt: Date | null }[];
  leagues: { id: number; name: string; leagueType: string; timeZone?: string | null; endedAt?: Date | null; status?: string }[];
  rounds: HomeRound[];
  matches: HomeMatch[];
  byes: { roundId: number; playerId: number }[];
  names: Map<number, string>;
  /** Leagues the viewer runs. */
  adminLeagueIds: number[];
  /** Q5b: each playoff match's play-by date, by match id. */
  playoffPlayBy?: Map<number, string>;
}

export interface HomeWeekItem {
  leagueId: number;
  leagueName: string;
  roundId: number;
  roundNumber: number;
  phase: RoundPhase;
  startDate: string;
  deadline: string;
  graceEnd: string;
  bye: boolean;
  matchId: number | null;
  myPlayerId: number;
  opponentName: string | null;
  /** The singles opponent, for Message on the Home card; null for doubles and byes. */
  opponentPlayerId: number | null;
  singles: boolean;
  scheduledAt: string | null;
  location: string | null;
  /** A score is in, so there's nothing left to enter or record. */
  played: boolean;
  /** The league's time zone, for its deadlines. */
  timeZone: string;
}

export interface HomePlayoffItem {
  leagueId: number;
  leagueName: string;
  matchId: number;
  round: string;
  opponentName: string;
  /** The singles opponent, for Message on the Home card; null for doubles. */
  opponentPlayerId: number | null;
  singles: boolean;
  timeZone: string;
  /** Last day to play this round (Q5b): a play week plus a grace week. */
  playBy: string | null;
  /** The play-by date has passed, so the league admin enters the result. */
  pastPlayBy: boolean;
  scheduledAt: string | null;
  location: string | null;
}

export interface HomeResult {
  leagueId: number;
  leagueName: string;
  matchId: number;
  opponentName: string;
  /** From the viewer's side: their games first. */
  score: string;
  won: boolean;
  inGrace: boolean;
  playoff: boolean;
  completedAt: string | null;
}

/** Your season across the leagues still running (finding 14: Home and My matches). */
export interface HomeSeason {
  wins: number;
  losses: number;
  played: number;
  /** Your latest results in a row, e.g. won 2; null before your first result. */
  streak: { won: boolean; count: number } | null;
}

/** Wins, losses and the current streak, from results newest first. */
export function seasonFrom(results: Pick<HomeResult, "won">[]): HomeSeason {
  const wins = results.filter((r) => r.won).length;
  let count = 0;
  for (const r of results) {
    if (r.won !== results[0].won) break;
    count++;
  }
  return {
    wins,
    losses: results.length - wins,
    played: results.length,
    streak: results.length ? { won: results[0].won, count } : null,
  };
}

export interface HomeDraft {
  leagueId: number;
  leagueName: string;
  roundId: number;
  roundNumber: number;
  startDate: string;
  /** The league's time zone: the round goes out at 7am there. */
  timeZone: string;
}


function sideOf(m: HomeMatch, playerId: number): 1 | 2 | null {
  if (m.player1Id === playerId || m.player3Id === playerId) return 1;
  if (m.player2Id === playerId || m.player4Id === playerId) return 2;
  return null;
}

/** The one opponent in a singles match; null in doubles. */
function singlesOpponent(m: HomeMatch, side: 1 | 2): number | null {
  const ids = (side === 1 ? [m.player2Id, m.player4Id] : [m.player1Id, m.player3Id]).filter((id): id is number => id != null);
  return ids.length === 1 ? ids[0] : null;
}

function opponentOf(m: HomeMatch, side: 1 | 2, names: Map<number, string>): string {
  const ids = side === 1 ? [m.player2Id, m.player4Id] : [m.player1Id, m.player3Id];
  return ids
    .filter((id): id is number => id != null)
    .map((id) => names.get(id) ?? "Player")
    .join(" & ");
}

export function buildLeagueHome(input: HomeInput) {
  const leagueName = (id: number) => input.leagues.find((l) => l.id === id)?.name ?? "League";
  const singles = (id: number) => (input.leagues.find((l) => l.id === id)?.leagueType ?? "singles") === "singles";
  const zone = (id: number) => leagueZone(input.leagues.find((l) => l.id === id));
  const todayIn = (id: number) => todayFor(input.leagues.find((l) => l.id === id), input.now);
  const live = input.matches.filter((m) => !m.voidedAt);

  const thisWeek: HomeWeekItem[] = [];
  for (const me of input.myPlayers) {
    if (me.leftAt || me.leagueId == null) continue;
    const rounds = input.rounds.filter((r) => r.leagueId === me.leagueId && r.publishedAt);
    for (const r of rounds) {
      const phase = roundPhase(r, todayIn(me.leagueId));
      if (phase !== "open" && phase !== "upcoming" && phase !== "grace") continue;
      const base = {
        leagueId: me.leagueId,
        leagueName: leagueName(me.leagueId),
        roundId: r.id,
        roundNumber: r.roundNumber,
        phase,
        startDate: r.startDate,
        deadline: r.endDate,
        graceEnd: graceEndFor(r.endDate),
        myPlayerId: me.id,
        singles: singles(me.leagueId),
        timeZone: zone(me.leagueId),
      };
      const match = live.find((m) => m.roundId === r.id && sideOf(m, me.id) !== null);
      // Grace-week rounds only matter while there's still a score to enter.
      if (phase === "grace" && (!match || match.status === "completed")) continue;
      if (match) {
        thisWeek.push({
          ...base,
          bye: false,
          matchId: match.id,
          opponentName: opponentOf(match, sideOf(match, me.id)!, input.names),
          opponentPlayerId: singlesOpponent(match, sideOf(match, me.id)!),
          scheduledAt: match.scheduledAt,
          location: match.location,
          played: match.status === "completed" || !!match.score,
        });
      } else if (input.byes.some((b) => b.roundId === r.id && b.playerId === me.id)) {
        thisWeek.push({ ...base, bye: true, matchId: null, opponentName: null, opponentPlayerId: null, scheduledAt: null, location: null, played: false });
      }
    }
  }
  // Only the next upcoming round per league; this week's rounds come first.
  const order: Record<string, number> = { grace: 0, open: 1, upcoming: 2 };
  thisWeek.sort((a, b) => order[a.phase] - order[b.phase] || a.deadline.localeCompare(b.deadline));
  const seenUpcoming = new Set<number>();
  const week = thisWeek.filter((i) => {
    if (i.phase !== "upcoming") return true;
    if (seenUpcoming.has(i.leagueId) || thisWeek.some((o) => o.leagueId === i.leagueId && o.phase === "open")) return false;
    seenUpcoming.add(i.leagueId);
    return true;
  });

  const myIds = new Set(input.myPlayers.map((p) => p.id));
  const mySide = (m: HomeMatch) => {
    for (const id of myIds) {
      const s = sideOf(m, id);
      if (s) return s;
    }
    return null;
  };

  const activeIds = new Set(input.myPlayers.filter((p) => !p.leftAt).map((p) => p.id));
  // C15: an ended league has no playoff match left to play.
  const ended = (id: number) => leagueHasEnded(input.leagues.find((l) => l.id === id));
  const playoffs: HomePlayoffItem[] = live
    .filter((m) => m.playoffBracketId && m.status !== "completed" && !ended(m.leagueId!) && [...activeIds].some((id) => sideOf(m, id)))
    .map((m) => {
      const playBy = input.playoffPlayBy?.get(m.id) ?? null;
      return {
        leagueId: m.leagueId!,
        leagueName: leagueName(m.leagueId!),
        matchId: m.id,
        round: m.playoffRound ?? "playoff",
        opponentName: opponentOf(m, mySide(m)!, input.names),
        opponentPlayerId: singlesOpponent(m, mySide(m)!),
        singles: singles(m.leagueId!),
        timeZone: zone(m.leagueId!),
        playBy,
        pastPlayBy: !!playBy && todayIn(m.leagueId!) > playBy,
        scheduledAt: m.scheduledAt,
        location: m.location,
      };
    });

  // Every result, newest first. Home shows the last five; My matches shows all.
  const results: HomeResult[] = live
    .filter((m) => m.status === "completed" && m.score && m.winnerId != null && mySide(m) && m.leagueId != null)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.id - a.id)
    .map((m) => {
      const side = mySide(m)!;
      return {
        leagueId: m.leagueId!,
        leagueName: leagueName(m.leagueId!),
        matchId: m.id,
        opponentName: opponentOf(m, side, input.names),
        score: side === 1 ? m.score! : flip(m.score!),
        won: (side === 1 ? m.player1Id : m.player2Id) === m.winnerId,
        inGrace: m.inGrace,
        playoff: !!m.playoffBracketId,
        completedAt: m.completedAt,
      };
    });

  const drafts: HomeDraft[] = input.rounds
    .filter((r) => !r.publishedAt && input.adminLeagueIds.includes(r.leagueId))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((r) => ({ leagueId: r.leagueId, leagueName: leagueName(r.leagueId), roundId: r.id, roundNumber: r.roundNumber, startDate: r.startDate, timeZone: zone(r.leagueId) }));

  // Season stats count leagues that are still running: an ended league's
  // season is over (decision 31).
  const season = seasonFrom(results.filter((r) => !ended(r.leagueId)));

  return { today: todayFor(null, input.now), thisWeek: week, playoffs, drafts, recent: results.slice(0, 5), results, season };
}

export interface HomeStandingRow {
  rank: number;
  playerId: number;
  playerName: string;
  wins: number;
  losses: number;
  you: boolean;
}

/** One of your leagues on Home: where you stand, and the top of its table. */
export interface HomeLeague {
  leagueId: number;
  leagueName: string;
  location: string | null;
  /** Your rank, or null once you're out of the standings. */
  rank: number | null;
  /** How many players are in the standings. */
  playerCount: number;
  wins: number;
  losses: number;
  /** The top three, plus your row if you're further down. */
  rows: HomeStandingRow[];
}

/**
 * Finding 14: with one league, Home shows its standings; with two or more,
 * a "Your leagues" list. Only leagues you play in that are still running.
 */
export function homeLeagues(input: {
  myPlayers: { id: number; leagueId: number | null; leftAt: Date | null }[];
  leagues: { id: number; name: string; location?: string | null; endedAt?: Date | null; status?: string }[];
  standings: Map<number, { rank: number; playerId: number; playerName: string; wins: number; losses: number }[]>;
}): HomeLeague[] {
  const out: HomeLeague[] = [];
  for (const me of input.myPlayers) {
    if (me.leftAt || me.leagueId == null) continue;
    const league = input.leagues.find((l) => l.id === me.leagueId);
    if (!league || leagueHasEnded(league)) continue;
    const table = input.standings.get(league.id) ?? [];
    const mine = table.find((r) => r.playerId === me.id);
    const top = table.slice(0, 3);
    const shown = mine && !top.includes(mine) ? [...top, mine] : top;
    out.push({
      leagueId: league.id,
      leagueName: league.name,
      location: league.location ?? null,
      rank: mine?.rank ?? null,
      playerCount: table.length,
      wins: mine?.wins ?? 0,
      losses: mine?.losses ?? 0,
      rows: shown.map((r) => ({ rank: r.rank, playerId: r.playerId, playerName: r.playerName, wins: r.wins, losses: r.losses, you: r.playerId === me.id })),
    });
  }
  return out.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
}
