import type { LeagueWeekSeason } from "@workspace/api-client-react";

import { flipScore, isDoubleDefault, isRetiredScore, readSet, WALKOVER_SCORE } from "./tennisScore";

// Match detail and the record screen's season line (findings 6, 7, 14; John,
// Nov 6). Pure, so it's tested in lib/__tests__.

/** "4–2" with an en dash, as records read everywhere. */
export function recordLabel(s: Pick<LeagueWeekSeason, "wins" | "losses">): string {
  return `${s.wins}–${s.losses}`;
}

export interface SetRow {
  you: number;
  them: number;
  /** The tiebreak loser's points, like the 4 in 7-6(4). */
  tiebreak: number | null;
}

/** "6-4, 7-6(4) RET" from your side, as set rows for the score table. W/O has none. */
export function setRows(score: string | null | undefined): SetRow[] {
  if (!score || score.trim() === WALKOVER_SCORE || isDoubleDefault(score)) return [];
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
  if (isDoubleDefault(input.score)) return `Double default: ${input.you} vs. ${input.them}`;
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

export type MatchSource = "league" | "discover" | "quick_match";

/** The words for a score that can't be edited any more, outside a league (decision 151). */
export const CASUAL_LOCKED = "Scores lock 24 hours after they're entered.";

/**
 * The footnote under the score: who entered it and how long it can still be
 * edited, or who to ask once it's locked (finding 7). A Discover or Quick
 * match has no league admin, so once its 24 hours are up it just says the
 * score is locked (decision 151).
 */
export function scoreFootnote(d: {
  played: boolean;
  enteredBy: string | null;
  enteredAt: string | null;
  editUntil: string | null;
  correctedBy: string | null;
  leagueEnded: boolean;
  source?: MatchSource;
}): string | null {
  if (!d.played) return null;
  const when = dayAndTime(d.enteredAt);
  const league = (d.source ?? "league") === "league";
  const entered = d.enteredBy
    ? `Entered by ${d.enteredBy}${when ? `, ${when}` : ""}.`
    : league
      ? "Entered by your league admin."
      : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ");
  if (league && d.leagueEnded) return join(entered, "This league has ended, so its scores are final.");
  if (d.editUntil) return join(entered, `Either player can edit it until ${dayAndTime(d.editUntil)}.`);
  if (!league) return join(entered, CASUAL_LOCKED);
  if (d.correctedBy) return entered;
  return join(entered, "Need a fix? Your league admin can correct it in Manage.");
}

/**
 * Where a match came from, under its date on Match detail: the league with
 * its round or playoff stage ("Men's 3.5 · Round 3"), "Discover" or "Quick
 * match" (decision 151). `stageName` names a playoff round ("Semifinal").
 */
export function matchSourceLine(
  d: { source?: MatchSource; context?: string | null; leagueName?: string | null; roundNumber: number | null; playoffRound: string | null },
  stageName: (round: string) => string | undefined = () => undefined,
): string {
  const source = d.source ?? "league";
  if (source === "discover") return "Discover";
  if (source === "quick_match") return "Quick match";
  const stage = d.playoffRound ? `Playoffs · ${stageName(d.playoffRound) ?? "Playoff"}` : d.roundNumber != null ? `Round ${d.roundNumber}` : null;
  return [d.leagueName ?? d.context ?? null, stage].filter(Boolean).join(" · ");
}
