// Match detail (finding 6, John, Nov 6; approved design audit, Match detail;
// decision 151, John, Nov 8): every match you played, league, Discover or
// Quick match, with one layout. Its plain details, where it came from, the
// score from your side, who entered or changed it, and the Ball Boi Replay
// once one exists. Pure, so it's easy to test.

import { contextFor } from "./career.js";
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
  /** "discover" or "discover_open_match" for a Discover match, "quick_match", or a league's own values. */
  generatedFrom: string | null;
}

export type MatchSource = "league" | "discover" | "quick_match";

/** Where a match came from: a league, Discover, or a Quick match. */
export function matchSource(m: Pick<DetailMatch, "leagueId" | "generatedFrom">): MatchSource {
  if (m.leagueId != null) return "league";
  return m.generatedFrom === "discover" || m.generatedFrom === "discover_open_match" ? "discover" : "quick_match";
}

export interface DetailPlayer {
  id: number;
  /** Profile name for a signed-up player, else the name on the league row. */
  name: string;
  clerkUserId: string | null;
  /** Their photo ("/objects/..."), already null for placeholders and blocks. */
  avatarUrl?: string | null;
}

export interface DetailInput {
  match: DetailMatch;
  /** Null for a Discover or Quick match. */
  league: { id: number; name: string; leagueType: string; timeZone?: string | null; endedAt?: Date | null; status?: string } | null;
  /** A Discover match card's court and time zone, when the match row has none. */
  plan?: { courtName: string | null; timeZone: string | null } | null;
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
    !!league && !played && !m.voidedAt && !m.playoffBracketId && !leagueHasEnded(league) && !!input.round && roundPhase(input.round, todayFor(league, now)) === "grace";
  const lateUntil = late && input.round ? graceEndFor(input.round.endDate) : null;
  const side = (team: DetailPlayer[], won: boolean | null) => ({
    players: team.map((p) => ({
      playerId: p.id,
      name: p.name,
      you: p.clerkUserId === userId,
      hasAccount: !!p.clerkUserId,
      avatarUrl: p.clerkUserId ? (p.avatarUrl ?? null) : null,
    })),
    won: !!won,
  });

  const source = matchSource(m);
  const leagueEnded = leagueHasEnded(league);
  const names = new Map(league ? [[league.id, { name: league.name }]] : []);

  return {
    matchId: m.id,
    source,
    leagueId: league?.id ?? null,
    leagueName: league?.name ?? null,
    /** The league's name, "Discover" or "Quick match". */
    context: contextFor(m, names),
    singles: league ? league.leagueType === "singles" : m.player3Id == null && m.player4Id == null,
    timeZone: league?.timeZone ?? input.plan?.timeZone ?? null,
    roundNumber: input.roundNumber,
    playoffRound: m.playoffBracketId ? (m.playoffRound ?? "playoff") : null,
    scheduledAt: m.scheduledAt,
    completedAt: m.completedAt,
    location: m.location ?? input.plan?.courtName ?? null,
    played,
    voided: !!m.voidedAt,
    inGrace: m.inGrace,
    lateUntil,
    /** From your side, your games first. */
    score: played ? (youOnTeam1 ? m.score! : flipScore(m.score!)) : null,
    you: side(yours, youWon),
    opponents: side(theirs, youWon === null ? null : !youWon),
    /** Who first entered the score: a player's name, or null when the admin did (or, outside a league, when it's unknown). */
    enteredBy: played && enteredBy && accounts.includes(enteredBy.clerkUserId!) ? enteredBy.name : null,
    enteredAt: played ? m.recordedAt : null,
    /**
     * Set while you can still edit the score (finding 7). The same 24 hours
     * for league, Discover and Quick matches (decision 151).
     */
    editUntil: leagueEnded ? null : editDeadline(m, userId, accounts, now),
    editedBy: played && m.scoreEditedAt ? (m.scoreEditedByName ?? "A player") : null,
    editedAt: played && m.scoreEditedAt ? m.scoreEditedAt.toISOString() : null,
    correctedBy: played && m.correctedAt ? (m.correctedByName ?? "League admin") : null,
    correctedAt: played && m.correctedAt ? m.correctedAt.toISOString() : null,
    leagueEnded,
    replay: input.replay,
  };
}
