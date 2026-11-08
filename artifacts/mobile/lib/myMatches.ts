import type { LeagueWeek, LeagueWeekItem, LeagueWeekPlayoff, LeagueWeekSeason } from "@workspace/api-client-react";

import { flipScore, isRetiredScore, readSet, WALKOVER_SCORE } from "./tennisScore";

// Home's season stats, My matches and Match detail (findings 6, 7, 14; John,
// Nov 6). Pure, so it's tested in lib/__tests__.

/** "4–2" with an en dash, as records read everywhere. */
export function recordLabel(s: Pick<LeagueWeekSeason, "wins" | "losses">): string {
  return `${s.wins}–${s.losses}`;
}

/** "67%", or a dash before your first result. */
export function winRateLabel(s: Pick<LeagueWeekSeason, "wins" | "played">): string {
  return s.played ? `${Math.round((s.wins / s.played) * 100)}%` : "–";
}

/** "Won 2" or "Lost 1", or a dash before your first result. */
export function streakLabel(s: Pick<LeagueWeekSeason, "streak">): string {
  return s.streak ? `${s.streak.won ? "Won" : "Lost"} ${s.streak.count}` : "–";
}

/** The season line as VoiceOver reads it, in one go. */
export function seasonSpoken(s: LeagueWeekSeason): string {
  if (!s.played) return "Your season. No results yet.";
  const streak = s.streak ? ` ${s.streak.won ? "Won" : "Lost"} your last ${s.streak.count}.` : "";
  return `Your season. Record ${s.wins} and ${s.losses}. Win rate ${winRateLabel(s)}.${streak} ${s.played} played.`;
}

/** One match still to play, from this week's rounds or the playoffs. */
export interface UpcomingMatch {
  key: string;
  leagueId: number;
  leagueName: string;
  matchId: number;
  opponentName: string;
  scheduledAt: string | null;
  location: string | null;
  /** "Round 3" or "Playoffs". */
  stage: string;
  /** "Play by Wed, Nov 25" style deadline, as a date. */
  playBy: string | null;
  timeZone: string;
  singles: boolean;
}

/**
 * Every match you still have to play, soonest first: ones with a set time by
 * that time, then the rest by their play-by date. Byes and played matches
 * aren't matches to play.
 */
export function upcomingMatches(week: Pick<LeagueWeek, "thisWeek" | "playoffs"> | undefined): UpcomingMatch[] {
  if (!week) return [];
  const weekly = week.thisWeek
    .filter((i): i is LeagueWeekItem & { matchId: number } => !i.bye && i.matchId != null && !i.played)
    .map((i) => ({
      key: `m-${i.matchId}`,
      leagueId: i.leagueId,
      leagueName: i.leagueName,
      matchId: i.matchId,
      opponentName: i.opponentName ?? "your opponent",
      scheduledAt: i.scheduledAt,
      location: i.location,
      stage: `Round ${i.roundNumber}`,
      playBy: i.phase === "grace" ? i.graceEnd : i.deadline,
      timeZone: i.timeZone,
      singles: i.singles,
    }));
  const playoffs = week.playoffs
    .filter((p: LeagueWeekPlayoff) => !p.pastPlayBy)
    .map((p) => ({
      key: `po-${p.matchId}`,
      leagueId: p.leagueId,
      leagueName: p.leagueName,
      matchId: p.matchId,
      opponentName: p.opponentName,
      scheduledAt: p.scheduledAt,
      location: p.location,
      stage: "Playoffs",
      playBy: p.playBy,
      timeZone: p.timeZone,
      singles: p.singles,
    }));
  const sortKey = (m: UpcomingMatch) => m.scheduledAt ?? `${m.playBy ?? "9999-12-31"}T23:59:59`;
  return [...weekly, ...playoffs].sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.matchId - b.matchId);
}

export interface SetRow {
  you: number;
  them: number;
  /** The tiebreak loser's points, like the 4 in 7-6(4). */
  tiebreak: number | null;
}

/** "6-4, 7-6(4) RET" from your side, as set rows for the score table. W/O has none. */
export function setRows(score: string | null | undefined): SetRow[] {
  if (!score || score.trim() === WALKOVER_SCORE) return [];
  return score
    .replace(/\s*RET$/, "")
    .split(",")
    .map((t) => readSet(t))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ you: s.a, them: s.b, tiebreak: s.tiebreak }));
}

/** "6-4, 7-5" from the winner's side, for Share and VoiceOver. */
export function winnerScore(score: string, youWon: boolean): string {
  return youWon ? score : flipScore(score);
}

/** How a result reads in words: "John Rapiel beat Ray Alvarez 6-4, 7-5". */
export function resultSentence(input: { you: string; them: string; score: string; youWon: boolean }): string {
  const [winner, loser] = input.youWon ? [input.you, input.them] : [input.them, input.you];
  const retired = isRetiredScore(input.score);
  const score = winnerScore(input.score, input.youWon).replace(/\s*RET$/, "");
  if (input.score.trim() === WALKOVER_SCORE) return `${winner} beat ${loser} by walkover`;
  return `${winner} beat ${loser} ${score}${retired ? `, ${loser.split(" ")[0]} retired` : ""}`;
}

/** "1h 32m" or "48m" for the Ball Boi Replay row. */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || seconds < 60) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "1 hour 32 minutes", for VoiceOver. */
export function durationSpoken(seconds: number | null | undefined): string | null {
  if (!seconds || seconds < 60) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : null);
  return [part(h, "hour"), part(m, "minute")].filter(Boolean).join(" ");
}

/** "Nov 7 at 7:41 PM", on the phone's clock. */
export function dayAndTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

/**
 * The footnote under the score: who entered it and how long it can still be
 * edited, or who to ask once it's locked (finding 7).
 */
export function scoreFootnote(d: {
  played: boolean;
  enteredBy: string | null;
  enteredAt: string | null;
  editUntil: string | null;
  correctedBy: string | null;
  leagueEnded: boolean;
}): string | null {
  if (!d.played) return null;
  const when = dayAndTime(d.enteredAt);
  const entered = d.enteredBy ? `Entered by ${d.enteredBy}${when ? `, ${when}` : ""}.` : "Entered by your league admin.";
  if (d.leagueEnded) return `${entered} This league has ended, so its scores are final.`;
  if (d.editUntil) return `${entered} Either player can edit it until ${dayAndTime(d.editUntil)}.`;
  if (d.correctedBy) return entered;
  return `${entered} Need a fix? Your league admin can correct it in Manage.`;
}
