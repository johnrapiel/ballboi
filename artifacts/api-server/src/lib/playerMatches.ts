// Another player's matches on their card (John, Nov 8, option C; spec
// decision 143): the same Upcoming matches and Results tabs as your own
// Profile, with the winner mark and head-to-head. Pure, so every privacy
// rule is tested in __tests__/playerMatches.test.ts.
//
// Privacy:
// - A player who blocked you, or whom you blocked, never shows: the card is
//   refused before this runs, and a match against someone blocked with you
//   is left off their list too.
// - Hidden profiles stay hidden: refused before this runs.
// - A Quick match isn't on someone's card until they answered Yes to "Was
//   that you?" (G2). Until then the match is on an unlinked stand-in row, so
//   it isn't theirs here.
// - Placeholder opponents (not on Ball Boi) show by name with no link.
// - Cancelled, voided and draft-round matches never show.
// - A private league's name shows only to its members; others see "League".
// - A court shows only where your own list would show it: a league match in
//   a league you're in. Never a Discover match's court.

import { roundPhase, todayFor } from "./leagueCalendar.js";

export interface PMMatch {
  id: number;
  leagueId: number | null;
  roundId: number | null;
  playoffBracketId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  status: string;
  score: string | null;
  winnerId: number | null;
  scheduledAt: string | null;
  completedAt: string | null;
  location: string | null;
  voidedAt: Date | null;
}

export interface PMPlayer {
  id: number;
  name: string;
  clerkUserId: string | null;
}

export interface PMLeague {
  id: number;
  name: string;
  visibility: string;
  endedAt: Date | null;
  timeZone: string | null;
}

export interface PMRound {
  id: number;
  publishedAt: Date | null;
  startDate: string;
  endDate: string;
}

/** An accepted Discover match card with no score yet. */
export interface PMPlan {
  id: number;
  startsAt: Date;
  otherClerkUserId: string;
  otherName: string;
  score: string | null;
}

export interface PMInput {
  /** The player whose card this is. */
  target: string;
  viewer: string;
  now: Date;
  matches: PMMatch[];
  players: Map<number, PMPlayer>;
  leagues: Map<number, PMLeague>;
  rounds: Map<number, PMRound>;
  plans: PMPlan[];
  /** Accounts blocked with the viewer, either way. */
  blocked: Set<string>;
  /** Leagues the viewer plays in or runs. */
  viewerLeagueIds: Set<number>;
  /** Account to user id, for links to a player's card. */
  userIds: Map<string, number>;
}

export interface PMUpcoming {
  key: string;
  kind: "league" | "playoff" | "discover";
  matchId: number | null;
  scheduledAt: string | null;
  /** Last day to play (YYYY-MM-DD) when no time is set. */
  playBy: string | null;
  opponentName: string;
  /** Null for a placeholder: show the name with no link. */
  opponentUserId: number | null;
  /** "Tuesday Flex 3.5", "League" for a private league you're not in, or "Discover". */
  context: string;
  location: string | null;
  /** You're in it: it can open Match detail. */
  mine: boolean;
}

export interface PMResult {
  matchId: number;
  player1Name: string;
  player2Name: string;
  player1UserId: number | null;
  player2UserId: number | null;
  /** As stored, from player 1's side. */
  score: string;
  winner: 1 | 2 | null;
  context: string;
  completedAt: string | null;
  mine: boolean;
}

export interface PMHeadToHead {
  /** Your wins against them. */
  you: number;
  them: number;
}

const DONE = new Set(["cancelled", "canceled", "voided", "forfeit"]);

const team = (m: PMMatch, side: 1 | 2) => (side === 1 ? [m.player1Id, m.player3Id] : [m.player2Id, m.player4Id]).filter((id): id is number => id != null);

export function playerMatches(input: PMInput): { upcoming: PMUpcoming[]; results: PMResult[]; headToHead: PMHeadToHead | null } {
  const owner = (id: number) => input.players.get(id)?.clerkUserId ?? null;
  const name = (id: number) => input.players.get(id)?.name ?? "Player";
  const userIdOf = (id: number) => {
    const o = owner(id);
    return o ? (input.userIds.get(o) ?? null) : null;
  };
  const sideOf = (m: PMMatch, account: string): 1 | 2 | null =>
    team(m, 1).some((id) => owner(id) === account) ? 1 : team(m, 2).some((id) => owner(id) === account) ? 2 : null;
  const touchesBlocked = (m: PMMatch) => [...team(m, 1), ...team(m, 2)].some((id) => {
    const o = owner(id);
    return o != null && input.blocked.has(o);
  });
  const context = (m: PMMatch) => {
    if (m.leagueId == null) return "Quick match";
    const l = input.leagues.get(m.leagueId);
    if (!l) return "League";
    return l.visibility === "open" || input.viewerLeagueIds.has(l.id) ? l.name : "League";
  };
  const teamName = (m: PMMatch, side: 1 | 2) => team(m, side).map(name).join(" & ");
  const singleUser = (m: PMMatch, side: 1 | 2) => (team(m, side).length === 1 ? userIdOf(team(m, side)[0]) : null);

  const upcoming: PMUpcoming[] = [];
  const results: PMResult[] = [];
  let h2h: PMHeadToHead = { you: 0, them: 0 };

  for (const m of input.matches) {
    const side = sideOf(m, input.target);
    if (side == null) continue;
    if (m.voidedAt || DONE.has(m.status)) continue;
    if (touchesBlocked(m)) continue;
    const league = m.leagueId != null ? input.leagues.get(m.leagueId) : undefined;
    const round = m.roundId != null ? input.rounds.get(m.roundId) : undefined;
    // A round match shows only once its round is out (never draft pairings).
    if (m.roundId != null && (!round || !round.publishedAt)) continue;
    const mine = sideOf(m, input.viewer) != null;
    const them = side === 1 ? 2 : 1;
    const scored = m.status === "completed" && !!m.score;

    if (scored) {
      const winner: 1 | 2 | null =
        m.winnerId == null ? null : team(m, 1).includes(m.winnerId) ? 1 : team(m, 2).includes(m.winnerId) ? 2 : null;
      results.push({
        matchId: m.id,
        player1Name: teamName(m, 1),
        player2Name: teamName(m, 2),
        player1UserId: singleUser(m, 1),
        player2UserId: singleUser(m, 2),
        score: m.score!,
        winner,
        context: context(m),
        completedAt: m.completedAt,
        mine,
      });
      const viewerSide = sideOf(m, input.viewer);
      if (viewerSide === them && winner != null) {
        if (winner === viewerSide) h2h = { ...h2h, you: h2h.you + 1 };
        else h2h = { ...h2h, them: h2h.them + 1 };
      }
      continue;
    }

    // Still to play: a league that's running, a round still open or in its
    // grace week, or a playoff match. Discover matches come from plans below.
    if (m.leagueId == null || !league || league.endedAt) continue;
    let playBy: string | null = null;
    if (round) {
      const phase = roundPhase(round, todayFor(league, input.now));
      if (phase !== "open" && phase !== "upcoming" && phase !== "grace") continue;
      playBy = round.endDate;
    } else if (m.playoffBracketId == null) {
      continue;
    }
    const inLeague = input.viewerLeagueIds.has(league.id);
    upcoming.push({
      key: `m-${m.id}`,
      kind: m.playoffBracketId != null ? "playoff" : "league",
      matchId: m.id,
      scheduledAt: m.scheduledAt,
      playBy,
      opponentName: teamName(m, them),
      opponentUserId: singleUser(m, them),
      context: m.playoffBracketId != null ? `${context(m)} · Playoffs` : context(m),
      location: inLeague ? m.location : null,
      mine,
    });
  }

  for (const p of input.plans) {
    if (p.score || input.blocked.has(p.otherClerkUserId)) continue;
    if (p.startsAt.getTime() < input.now.getTime() - 3 * 3_600_000) continue;
    upcoming.push({
      key: `plan-${p.id}`,
      kind: "discover",
      matchId: null,
      scheduledAt: p.startsAt.toISOString(),
      playBy: null,
      opponentName: p.otherName,
      opponentUserId: input.userIds.get(p.otherClerkUserId) ?? null,
      context: "Discover",
      location: null,
      mine: p.otherClerkUserId === input.viewer,
    });
  }

  const sortAt = (u: PMUpcoming) => (u.scheduledAt ? new Date(u.scheduledAt).toISOString() : `${u.playBy ?? "9999-12-31"}T23:59:59.000Z`);
  upcoming.sort((a, b) => sortAt(a).localeCompare(sortAt(b)) || a.key.localeCompare(b.key));
  results.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.matchId - a.matchId);
  return { upcoming, results, headToHead: h2h.you + h2h.them > 0 ? h2h : null };
}
