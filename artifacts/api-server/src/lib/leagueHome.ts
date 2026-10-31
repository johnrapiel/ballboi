// What the Home tab shows from leagues (spec: Navigation > Home: upcoming
// matches, this week's pairings, recent results). Pure, so it's easy to test.

import { graceEndFor, roundPhase, type RoundPhase } from "./leagueCalendar.js";

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
  today: string;
  /** The viewer's player rows, one per league. */
  myPlayers: { id: number; leagueId: number | null; leftAt: Date | null }[];
  leagues: { id: number; name: string; leagueType: string }[];
  rounds: HomeRound[];
  matches: HomeMatch[];
  byes: { roundId: number; playerId: number }[];
  names: Map<number, string>;
  /** Leagues the viewer runs. */
  adminLeagueIds: number[];
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
  singles: boolean;
  scheduledAt: string | null;
  location: string | null;
}

export interface HomePlayoffItem {
  leagueId: number;
  leagueName: string;
  matchId: number;
  round: string;
  opponentName: string;
  singles: boolean;
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

export interface HomeDraft {
  leagueId: number;
  leagueName: string;
  roundId: number;
  roundNumber: number;
  startDate: string;
}

function flip(score: string): string {
  return score
    .split(",")
    .map((set) => {
      const x = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return x ? `${x[2]}-${x[1]}${x[3] ?? ""}` : set.trim();
    })
    .join(", ");
}

function sideOf(m: HomeMatch, playerId: number): 1 | 2 | null {
  if (m.player1Id === playerId || m.player3Id === playerId) return 1;
  if (m.player2Id === playerId || m.player4Id === playerId) return 2;
  return null;
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
  const live = input.matches.filter((m) => !m.voidedAt);

  const thisWeek: HomeWeekItem[] = [];
  for (const me of input.myPlayers) {
    if (me.leftAt || me.leagueId == null) continue;
    const rounds = input.rounds.filter((r) => r.leagueId === me.leagueId && r.publishedAt);
    for (const r of rounds) {
      const phase = roundPhase(r, input.today);
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
          scheduledAt: match.scheduledAt,
          location: match.location,
        });
      } else if (input.byes.some((b) => b.roundId === r.id && b.playerId === me.id)) {
        thisWeek.push({ ...base, bye: true, matchId: null, opponentName: null, scheduledAt: null, location: null });
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
  const playoffs: HomePlayoffItem[] = live
    .filter((m) => m.playoffBracketId && m.status !== "completed" && [...activeIds].some((id) => sideOf(m, id)))
    .map((m) => ({
      leagueId: m.leagueId!,
      leagueName: leagueName(m.leagueId!),
      matchId: m.id,
      round: m.playoffRound ?? "playoff",
      opponentName: opponentOf(m, mySide(m)!, input.names),
      singles: singles(m.leagueId!),
    }));

  const recent: HomeResult[] = live
    .filter((m) => m.status === "completed" && m.score && m.winnerId != null && mySide(m) && m.leagueId != null)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.id - a.id)
    .slice(0, 5)
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
    .map((r) => ({ leagueId: r.leagueId, leagueName: leagueName(r.leagueId), roundId: r.id, roundNumber: r.roundNumber, startDate: r.startDate }));

  return { today: input.today, thisWeek: week, playoffs, drafts, recent };
}
