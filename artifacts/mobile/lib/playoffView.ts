import type { BracketRound, BracketSeed, BracketSlot } from "@workspace/api-client-react";

import { WALKOVER_SCORE, flipScore } from "./tennisScore";

// What the bracket and the score screens say about a playoff match (spec:
// Leagues > Setup, playoffs; Wave 1 review C9, C15, C18, C24, Q5, Q5b).
// Pure, so it's tested in lib/__tests__.

type Round = BracketSlot["round"];

/** The line under Save on the score screen, and its VoiceOver hint (C9). */
export function scoreNote(input: { correcting: boolean; settling: boolean; playoffRound: Round | null }): { text: string; hint: string } {
  if (input.correcting) return { text: "Players can't change a score. Only league admins can correct one.", hint: "Asks you to confirm, then updates standings" };
  if (input.settling) return { text: "The winner moves on in the playoffs. Both players are told.", hint: "Asks you to confirm" };
  if (input.playoffRound === "final") {
    return { text: "This decides the champion. Your league admin can correct it.", hint: "Decides the champion" };
  }
  if (input.playoffRound) {
    return { text: "This sends the winner to the next round. Your league admin can correct it.", hint: "Sends the winner to the next round" };
  }
  return { text: "You can undo for 10 minutes after you save. After that, the score stands.", hint: "You can undo it for 10 minutes" };
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
