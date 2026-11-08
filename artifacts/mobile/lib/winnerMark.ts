import { flipScore, isRetiredScore, WALKOVER_SCORE } from "./tennisScore";

// The winner mark (John, Nov 8, approved as drawn): wherever a finished match
// shows both players, the winner's name is bold in ink with a brush underline,
// the loser's is regular in ink-muted, and the line under the names is only
// the score from the winner's side, with RET or W/O tags. No "X won" on
// screen; VoiceOver reads "[Winner] won [score]". Pure, so it's tested in
// lib/__tests__/winnerMark.test.ts.

export type Side = 1 | 2;

/** How each name is drawn. */
export type NameStyle = "winner" | "loser" | "muted" | "plain";

export interface WinnerMarkInput {
  player1Name: string;
  player2Name: string;
  /** The stored score, from player 1's side ("6-3, 7-6(4)", "6-3, 2-1 RET", "W/O"). */
  score: string | null | undefined;
  /** Which side won, or null when there's no result. */
  winner: Side | null;
  /**
   * What the match is when there's no winner: "Not played" (it's over and
   * wasn't played, so both names are muted), "Cancelled" (also muted), or a
   * status like "Not played yet" (names in plain ink).
   */
  status?: string;
}

export interface WinnerMark {
  winner: Side | null;
  player1: NameStyle;
  player2: NameStyle;
  /** The line under the names: "6-3, 6-4", "6-3, 2-1 · RET", "W/O", or the status. */
  line: string;
  /** The result for VoiceOver: "Andre Thomas won 7-6(8), 7-6(6)", or the status. */
  spoken: string;
}

const MUTED_STATUSES = new Set(["Not played", "Cancelled"]);

/** The score from the winner's side, as shown: RET and W/O as tags. */
export function winnerScoreLine(score: string, winnerIsPlayer1: boolean): string {
  const s = score.trim();
  if (s === WALKOVER_SCORE) return WALKOVER_SCORE;
  const retired = isRetiredScore(s);
  const body = retired ? s.replace(/\s*RET$/, "") : s;
  const sets = winnerIsPlayer1 ? body : flipScore(body);
  return retired ? `${sets} · RET` : sets;
}

export function winnerMark(input: WinnerMarkInput): WinnerMark {
  const score = input.score?.trim();
  if (input.winner && score) {
    const p1Won = input.winner === 1;
    const winnerName = p1Won ? input.player1Name : input.player2Name;
    const loserName = p1Won ? input.player2Name : input.player1Name;
    const line = winnerScoreLine(score, p1Won);
    let spoken: string;
    if (score === WALKOVER_SCORE) spoken = `${winnerName} won by walkover`;
    else if (isRetiredScore(score)) spoken = `${winnerName} won ${line.replace(/ · RET$/, "")}, ${loserName} retired`;
    else spoken = `${winnerName} won ${line}`;
    return { winner: input.winner, player1: p1Won ? "winner" : "loser", player2: p1Won ? "loser" : "winner", line, spoken };
  }
  const status = input.status ?? "Not played yet";
  const style: NameStyle = MUTED_STATUSES.has(status) ? "muted" : "plain";
  return { winner: null, player1: style, player2: style, line: status, spoken: status };
}

/** Which side a winner id belongs to, or null. */
export function sideOf(winnerId: number | null | undefined, player1Id: number | null | undefined, player2Id: number | null | undefined): Side | null {
  if (winnerId == null) return null;
  if (winnerId === player1Id) return 1;
  if (winnerId === player2Id) return 2;
  return null;
}
