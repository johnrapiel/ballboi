// Career stats (spec decision 147, John, Nov 8): your full history, opened
// from See all on Profile's This season. Pure, so every number is tested in
// __tests__/career.test.ts.
//
// What counts (the same rule as This season, decision 121):
// - a scored, unvoided, uncancelled match against a real Ball Boi player:
//   league, Discover, or a Quick match the other player confirmed. An
//   unconfirmed Quick match (G2) is still on an unlinked stand-in row, and a
//   placeholder has no account, so neither counts.
// - a walkover (W/O) counts toward the record and the streak, but it has no
//   sets or games, so it adds nothing to the set, game or tiebreak numbers.
// - a retirement's games count; its unfinished last set doesn't.
// - a match tiebreak (first to 10) counts as one game and one tiebreak.
//
// Results and Seasons list every match you played, the same rule as
// Profile's Results (John, Nov 10): league, Discover and Quick match,
// placeholders and unconfirmed Quick matches by the name you typed, and never
// a match against someone blocked with you. A double default stays out of
// Career (decision 170). The numbers above still count by decision 121.
//
// Head-to-head lists every real opponent you've played, singles and doubles,
// counting each person on the other side. A player blocked with you, either
// way, never shows there (their matches still count in your totals).
//
// Ball Boi career stats (aces, winners) join here once they pass their
// accuracy bars (G1). Add them as a `ballBoi` block on CareerStats, computed
// from match_statistics, and the Career screen gets a section for it. Until
// then the API doesn't send them, so nothing shows on screen.

import { flipScore, isCompleteSet, isDoubleDefault, isMatchTiebreak, readSet, WALKOVER_SCORE } from "./tennisScore.js";

export interface CareerMatch {
  id: number;
  leagueId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  winnerId: number | null;
  status: string;
  score: string | null;
  completedAt: string | null;
  voidedAt: Date | null;
  generatedFrom: string | null;
  playoffBracketId: number | null;
}

export interface CareerInput {
  account: string;
  matches: CareerMatch[];
  /** Player row to its account (null for a placeholder or stand-in) and name. */
  players: Map<number, { clerkUserId: string | null; name: string }>;
  /** Account to its user id and display name, for head-to-head links. */
  users: Map<string, { userId: number; name: string }>;
  leagues: Map<number, { name: string }>;
  /** Global seasons (league_id is null). */
  seasons: { name: string; startDate: string; endDate: string }[];
  /** Accounts blocked with this one, either way. */
  blocked: Set<string>;
}

export interface WonLost {
  won: number;
  lost: number;
}

export interface CareerSeason {
  /** Stable key the app uses to show this season's results. */
  key: string;
  name: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  wins: number;
  losses: number;
  played: number;
}

export interface CareerResult {
  matchId: number;
  seasonKey: string;
  opponentName: string;
  /** Your partner in doubles, else null. */
  partnerName: string | null;
  /** Null when no winner was recorded. */
  won: boolean | null;
  /** From your side, your games first. RET and W/O carry over. */
  score: string;
  /** League name, "Discover" or "Quick match". */
  context: string;
  playoff: boolean;
  /** A league match. Every result opens Match detail (decision 151). */
  league: boolean;
  completedAt: string | null;
}

export interface CareerHeadToHead {
  /** Null when they have no Ball Boi profile to open. */
  userId: number | null;
  name: string;
  wins: number;
  losses: number;
}

export interface CareerStats {
  wins: number;
  losses: number;
  played: number;
  bestWinStreak: number;
  sets: WonLost;
  games: WonLost;
  tiebreaks: WonLost;
  /** Newest first, only seasons you played in. */
  seasons: CareerSeason[];
  /** Newest first. */
  results: CareerResult[];
  /** Most played first. */
  headToHead: CareerHeadToHead[];
}

const NOT_PLAYED = new Set(["cancelled", "canceled", "voided", "forfeit"]);

const team = (m: CareerMatch, side: 1 | 2) =>
  (side === 1 ? [m.player1Id, m.player3Id] : [m.player2Id, m.player4Id]).filter((id): id is number => id != null);

/** Sets, games and tiebreaks from one score, from your side. A walkover has none. */
export function scoreTotals(scoreFromYourSide: string): { sets: WonLost; games: WonLost; tiebreaks: WonLost } {
  const out = { sets: { won: 0, lost: 0 }, games: { won: 0, lost: 0 }, tiebreaks: { won: 0, lost: 0 } };
  const s = scoreFromYourSide.trim();
  if (!s || s === WALKOVER_SCORE) return out;
  const retired = /\sRET$/.test(s);
  const parts = (retired ? s.replace(/\s*RET$/, "") : s).split(",").map((p) => p.trim()).filter(Boolean);
  parts.forEach((part, i) => {
    const set = readSet(part);
    if (!set) return;
    const mine = set.a > set.b;
    if (isMatchTiebreak(set)) {
      // First to 10: one game and one tiebreak to its winner.
      if (mine) {
        out.games.won++;
        out.sets.won++;
        out.tiebreaks.won++;
      } else {
        out.games.lost++;
        out.sets.lost++;
        out.tiebreaks.lost++;
      }
      return;
    }
    out.games.won += set.a;
    out.games.lost += set.b;
    const unfinished = retired && i === parts.length - 1 && !isCompleteSet(set);
    if (unfinished) return;
    if (mine) out.sets.won++;
    else out.sets.lost++;
    if (Math.max(set.a, set.b) === 7 && Math.min(set.a, set.b) === 6) {
      if (mine) out.tiebreaks.won++;
      else out.tiebreaks.lost++;
    }
  });
  return out;
}

/** The global season a day (YYYY-MM-DD) falls in, else its calendar year. */
function seasonFor(day: string, seasons: CareerInput["seasons"]): Omit<CareerSeason, "wins" | "losses" | "played"> {
  const s = seasons
    .filter((x) => x.startDate <= day && x.endDate >= day)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (s) return { key: `s:${s.startDate}:${s.endDate}`, name: s.name, from: s.startDate, to: s.endDate };
  const year = day.slice(0, 4);
  return { key: `y:${year}`, name: year, from: `${year}-01-01`, to: `${year}-12-31` };
}

/** A match that counts toward your career, from your side. */
export interface CountedMatch {
  m: CareerMatch;
  side: 1 | 2;
  /** Null when no winner was recorded. */
  won: boolean | null;
  /** completedAt, or "" when missing. */
  at: string;
  /** Accounts on the other side. */
  opponents: string[];
}

/** Every match that counts toward the account's career, oldest first. Shared with milestones. */
export function countedMatches(input: Pick<CareerInput, "account" | "matches" | "players">): CountedMatch[] {
  const owner = (id: number) => input.players.get(id)?.clerkUserId ?? null;
  const sideOf = (m: CareerMatch): 1 | 2 | null => {
    const one = team(m, 1).some((id) => owner(id) === input.account);
    const two = team(m, 2).some((id) => owner(id) === input.account);
    return one === two ? null : one ? 1 : 2;
  };
  const counted: CountedMatch[] = [];
  for (const m of input.matches) {
    if (m.status !== "completed" || !m.score || m.voidedAt || NOT_PLAYED.has(m.status)) continue;
    // A doubles double default (John, Nov 9) wasn't played: no result to count.
    if (isDoubleDefault(m.score)) continue;
    const side = sideOf(m);
    if (side == null) continue;
    const opponents = team(m, side === 1 ? 2 : 1)
      .map(owner)
      .filter((o): o is string => o != null && o !== input.account);
    // A placeholder or an unconfirmed Quick match stand-in: not a real match yet.
    if (!opponents.length) continue;
    const won = m.winnerId == null ? null : team(m, side).includes(m.winnerId) ? true : team(m, side === 1 ? 2 : 1).includes(m.winnerId) ? false : null;
    counted.push({ m, side, won, at: m.completedAt ?? "", opponents });
  }
  return counted.sort((a, b) => a.at.localeCompare(b.at) || a.m.id - b.m.id);
}

/** A match on your Results and Seasons lists, from your side. */
interface ListedMatch {
  m: CareerMatch;
  side: 1 | 2;
  won: boolean | null;
  at: string;
}

/**
 * Every match you played, for Results and Seasons, newest first: the same
 * rule as Profile's Results. Wider than countedMatches: a placeholder or an
 * unconfirmed Quick match lists, by the name you typed.
 */
export function listedMatches(input: Pick<CareerInput, "account" | "matches" | "players" | "blocked">): ListedMatch[] {
  const owner = (id: number) => input.players.get(id)?.clerkUserId ?? null;
  const listed: ListedMatch[] = [];
  for (const m of input.matches) {
    if (m.status !== "completed" || !m.score || m.voidedAt || NOT_PLAYED.has(m.status)) continue;
    if (isDoubleDefault(m.score)) continue;
    const one = team(m, 1).some((id) => owner(id) === input.account);
    const two = team(m, 2).some((id) => owner(id) === input.account);
    if (one === two) continue;
    const touchesBlocked = [...team(m, 1), ...team(m, 2)].some((id) => {
      const o = owner(id);
      return o != null && input.blocked.has(o);
    });
    if (touchesBlocked) continue;
    const side: 1 | 2 = one ? 1 : 2;
    const won = m.winnerId == null ? null : team(m, side).includes(m.winnerId) ? true : team(m, side === 1 ? 2 : 1).includes(m.winnerId) ? false : null;
    listed.push({ m, side, won, at: m.completedAt ?? "" });
  }
  return listed.sort((a, b) => b.at.localeCompare(a.at) || b.m.id - a.m.id);
}

export function careerStats(input: CareerInput): CareerStats {
  const owner = (id: number) => input.players.get(id)?.clerkUserId ?? null;
  const counted = countedMatches(input);

  const totals = { sets: { won: 0, lost: 0 }, games: { won: 0, lost: 0 }, tiebreaks: { won: 0, lost: 0 } };
  /** Each season's record, by decision 121. */
  const records = new Map<string, { wins: number; losses: number; played: number }>();
  const h2h = new Map<string, CareerHeadToHead>();
  let wins = 0;
  let losses = 0;
  let best = 0;
  let run = 0;

  for (const c of counted) {
    const mine = c.side === 1 ? c.m.score! : flipScore(c.m.score!);
    const t = scoreTotals(mine);
    for (const k of ["sets", "games", "tiebreaks"] as const) {
      totals[k].won += t[k].won;
      totals[k].lost += t[k].lost;
    }
    const key = seasonFor(c.at.slice(0, 10) || "1970-01-01", input.seasons).key;
    const record = records.get(key) ?? { wins: 0, losses: 0, played: 0 };
    record.played++;
    records.set(key, record);
    if (c.won == null) {
      run = 0;
      continue;
    }
    if (c.won) {
      wins++;
      record.wins++;
      run++;
      best = Math.max(best, run);
    } else {
      losses++;
      record.losses++;
      run = 0;
    }
    for (const o of c.opponents) {
      if (input.blocked.has(o)) continue;
      const u = input.users.get(o);
      const row = h2h.get(o) ?? { userId: u?.userId ?? null, name: u?.name ?? "Player", wins: 0, losses: 0 };
      if (c.won) row.wins++;
      else row.losses++;
      h2h.set(o, row);
    }
  }

  // Results and Seasons: every match you played, newest first.
  const nameOf = (id: number) => {
    const o = owner(id);
    return (o ? input.users.get(o)?.name : undefined) ?? input.players.get(id)?.name ?? "Player";
  };
  const seasons = new Map<string, CareerSeason>();
  const results: CareerResult[] = [];
  for (const l of listedMatches(input)) {
    const s = seasonFor(l.at.slice(0, 10) || "1970-01-01", input.seasons);
    // Newest first, so a season's first row sets its place in the list.
    if (!seasons.has(s.key)) seasons.set(s.key, { ...s, ...(records.get(s.key) ?? { wins: 0, losses: 0, played: 0 }) });
    const ours = team(l.m, l.side);
    const partner = ours.filter((id) => owner(id) !== input.account);
    results.push({
      matchId: l.m.id,
      seasonKey: s.key,
      opponentName: team(l.m, l.side === 1 ? 2 : 1).map(nameOf).join(" & "),
      partnerName: ours.length > 1 && partner.length ? partner.map(nameOf).join(" & ") : null,
      won: l.won,
      score: l.side === 1 ? l.m.score! : flipScore(l.m.score!),
      context: contextFor(l.m, input.leagues),
      playoff: l.m.playoffBracketId != null,
      league: l.m.leagueId != null,
      completedAt: l.m.completedAt,
    });
  }

  return {
    wins,
    losses,
    played: counted.length,
    bestWinStreak: best,
    ...totals,
    seasons: [...seasons.values()],
    results,
    headToHead: [...h2h.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || a.name.localeCompare(b.name)),
  };
}

/** Where a match was played: its league, Discover, or a Quick match. */
export function contextFor(m: Pick<CareerMatch, "leagueId" | "generatedFrom">, leagues: Map<number, { name: string }>): string {
  if (m.leagueId != null) return leagues.get(m.leagueId)?.name ?? "League";
  if (m.generatedFrom === "discover" || m.generatedFrom === "discover_open_match") return "Discover";
  return "Quick match";
}
