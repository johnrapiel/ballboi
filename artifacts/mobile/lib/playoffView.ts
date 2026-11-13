import type { BracketRound, BracketSeed, BracketSlot } from "@workspace/api-client-react";

import { WALKOVER_SCORE, flipScore } from "./tennisScore";

// What the bracket and the score screens say about a playoff match (spec:
// Leagues > Setup, playoffs; Wave 1 review C9, C15, C18, C24, Q5, Q5b).
// Pure, so it's tested in lib/__tests__.

type Round = BracketSlot["round"];

/** The line under Save on the score screen, and its VoiceOver hint (C9). */
export function scoreNote(input: { correcting: boolean; settling: boolean; editing?: boolean; playoffRound: Round | null }): { text: string; hint: string } {
  if (input.editing) return { text: "Standings update, and your opponent sees that you edited it.", hint: "Saves your edit and updates standings" };
  // Players can edit a score for 24 hours (spec decision 100), so this never says they can't.
  if (input.correcting) return { text: "Standings update, and both players see that you corrected it.", hint: "Asks you to confirm, then updates standings" };
  if (input.settling) return { text: "The winner moves on in the playoffs. Both players are told.", hint: "Asks you to confirm" };
  if (input.playoffRound === "final") {
    return { text: "This decides the champion. Either player can edit it for 24 hours.", hint: "Decides the champion" };
  }
  if (input.playoffRound) {
    return { text: "This sends the winner to the next round. Either player can edit it for 24 hours, until that round is played.", hint: "Sends the winner to the next round" };
  }
  return { text: "Either player can edit it for 24 hours after you save.", hint: "Either player can edit it for 24 hours" };
}

/**
 * The visible line under Enter score's helper text (Wave 2 finding 55, canvas
 * note C2): who can edit the score and for how long, so it isn't VoiceOver
 * only. A playoff match also locks once the next round is played.
 */
export function editWindowLine(input: { doubles: boolean; playoffRound?: Round | null }): string {
  const who = input.doubles ? "Any of the four" : "Either of you";
  const tail = input.playoffRound && input.playoffRound !== "final" ? ", until the next round is played" : "";
  return `${who} can edit it for 24 hours${tail}.`;
}

/** A stored score (player 1's side) from the winner's side, or "by W/O" (C18, Q5). */
export function slotWinningScore(slot: Pick<BracketSlot, "score" | "winnerId" | "player1">): string | null {
  if (!slot.score || slot.winnerId == null) return null;
  if (slot.score.trim() === WALKOVER_SCORE) return `by ${WALKOVER_SCORE}`;
  return slot.player1?.playerId === slot.winnerId ? slot.score : flipScore(slot.score);
}

function winnerOf(slot: Pick<BracketSlot, "winnerId" | "player1" | "player2">): BracketSeed | null {
  if (slot.winnerId == null) return null;
  return slot.player1?.playerId === slot.winnerId ? slot.player1 : slot.player2;
}

/**
 * The match's result in words: "Sam won 6-3, 6-4" from Sam's side (C18), or
 * where it stands. In an ended league nothing says "Not played yet" (C24).
 */
export function slotResult(slot: BracketSlot, round: Pick<BracketRound, "pastPlayBy">, ended: boolean): string {
  const score = slotWinningScore(slot);
  if (score) return `${winnerOf(slot)?.playerName ?? "Winner"} won ${score}`;
  if (ended) return "Not played";
  if (!slot.matchId) return "Waiting on earlier matches";
  if (round.pastPlayBy) return "Not played by the play-by date. The league admin enters the result.";
  return "Not played yet";
}

/**
 * Who can do what with a slot. Players enter a score until the round's
 * play-by date; after it, an admin enters the result or a walkover (Q5b).
 * Nothing in an ended league (C15).
 */
export function slotActions(
  slot: BracketSlot,
  round: Pick<BracketRound, "pastPlayBy">,
  opts: { myPlayerId: number | null | undefined; isAdmin: boolean; ended: boolean },
): { enterScore: boolean; settle: boolean } {
  const open = !opts.ended && slot.matchId != null && slot.status !== "completed" && !!slot.player1 && !!slot.player2;
  const mine = opts.myPlayerId != null && (slot.player1?.playerId === opts.myPlayerId || slot.player2?.playerId === opts.myPlayerId);
  return { enterScore: open && mine && !round.pastPlayBy, settle: open && opts.isAdmin && round.pastPlayBy };
}
