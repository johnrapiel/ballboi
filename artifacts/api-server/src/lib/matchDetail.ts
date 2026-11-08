// Match detail (finding 6, John, Nov 6; approved design audit, Match detail):
// a league match's plain details, the score from your side, who entered or
// changed it, and the Ball Boi Replay once one exists. Pure, so it's easy to test.

import { editDeadline } from "./leagueScoreChanges.js";
import { graceEndFor, roundPhase, todayFor } from "./leagueCalendar.js";
import { leagueHasEnded } from "./leagueLifecycle.js";
import { flipScore } from "./tennisScore.js";

export interface DetailMatch {
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
  scheduledAt: string | null;
  completedAt: string | null;
  location: string | null;
  playoffBracketId: number | null;
  playoffRound: string | null;
  recordedAt: string | null;
  recordedByClerkUserId: string | null;
  correctedAt: Date | null;
  correctedByName: string | null;
  scoreEditedAt: Date | null;
  scoreEditedByName: string | null;
}

export interface DetailPlayer {
  id: number;
  /** Profile name for a signed-up player, else the name on the league row. */
  name: string;
  clerkUserId: string | null;
}

export interface DetailInput {
  match: DetailMatch;
  league: { id: number; name: string; leagueType: string; timeZone?: string | null; endedAt?: Date | null; status?: string };
  players: DetailPlayer[];
  roundNumber: number | null;
  /** The match's round, for late matches (decision 152). */
  round?: { publishedAt: Date | null; startDate: string; endDate: string } | null;
  userId: string;
  replay: { durationSeconds: number | null; shotCount: number } | null;
  now: Date;
}

export function buildMatchDetail(input: DetailInput) {
  const { match: m, league, players, userId, now } = input;
  const player = (id: number | null) => (id == null ? null : players.find((p) => p.id === id) ?? null);
  const team1 = [m.player1Id, m.player3Id].map(player).filter((p): p is DetailPlayer => !!p);
  const team2 = [m.player2Id, m.player4Id].map(player).filter((p): p is DetailPlayer => !!p);
  const youOnTeam1 = team1.some((p) => p.clerkUserId === userId);
  const [yours, theirs] = youOnTeam1 ? [team1, team2] : [team2, team1];
  const played = m.status === "completed" && !!m.score && !m.voidedAt;
  const team1Won = m.winnerId != null && (m.winnerId === m.player1Id || m.winnerId === m.player3Id);
  const youWon = played && m.winnerId != null ? team1Won === youOnTeam1 : null;
  const accounts = players.filter((p) => [...team1, ...team2].includes(p) && p.clerkUserId).map((p) => p.clerkUserId!);
  const enteredBy = m.recordedByClerkUserId ? players.find((p) => p.clerkUserId === m.recordedByClerkUserId) : null;
  // Decision 152: an unplayed league match past its round's deadline, in its
  // extra week. The last day to play it (YYYY-MM-DD, the league's zone).
  const late =
    !played && !m.voidedAt && !m.playoffBracketId && !leagueHasEnded(league) && input.round && roundPhase(input.round, todayFor(league, now)) === "grace";
  const lateUntil = late && input.round ? graceEndFor(input.round.endDate) : null;
  const side = (team: DetailPlayer[], won: boolean | null) => ({
    players: team.map((p) => ({ playerId: p.id, name: p.name, you: p.clerkUserId === userId, hasAccount: !!p.clerkUserId })),
    won: !!won,
  });

  return {
    matchId: m.id,
    leagueId: league.id,
    leagueName: league.name,
    singles: league.leagueType === "singles",
    timeZone: league.timeZone ?? null,
    roundNumber: input.roundNumber,
    playoffRound: m.playoffBracketId ? (m.playoffRound ?? "playoff") : null,
    scheduledAt: m.scheduledAt,
    completedAt: m.completedAt,
    location: m.location,
    played,
    voided: !!m.voidedAt,
    inGrace: m.inGrace,
    lateUntil,
    /** From your side, your games first. */
    score: played ? (youOnTeam1 ? m.score! : flipScore(m.score!)) : null,
    you: side(yours, youWon),
    opponents: side(theirs, youWon === null ? null : !youWon),
    /** Who first entered the score: a player's name, or null when the admin did. */
    enteredBy: played && enteredBy && accounts.includes(enteredBy.clerkUserId!) ? enteredBy.name : null,
    enteredAt: played ? m.recordedAt : null,
    /** Set while you can still edit the score (finding 7). */
    editUntil: leagueHasEnded(league) ? null : editDeadline(m, userId, accounts, now),
    editedBy: played && m.scoreEditedAt ? (m.scoreEditedByName ?? "A player") : null,
    editedAt: played && m.scoreEditedAt ? m.scoreEditedAt.toISOString() : null,
    correctedBy: played && m.correctedAt ? (m.correctedByName ?? "League admin") : null,
    correctedAt: played && m.correctedAt ? m.correctedAt.toISOString() : null,
    leagueEnded: leagueHasEnded(league),
    replay: input.replay,
  };
}
