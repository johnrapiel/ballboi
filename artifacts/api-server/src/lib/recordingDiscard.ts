// Discarding a recording before it reaches the server (John approved, Oct 31;
// coordinator note on #79, D1 to D3).
//
// - A session can be discarded only by the person who recorded it, and only
//   while its upload hasn't finished (status "recording"). After that,
//   deletion follows the analysis rules in #75.
// - A league match, its score, and a Quick match against a real player are
//   never touched: only the recording goes.
// - A Quick match against a placeholder opponent (someone not on Ball Boi,
//   invite not yet used) exists only because of this recording, so it goes
//   too, unless another recording of it remains.

export interface DiscardInput {
  match: { leagueId: number | null; player1Id: number; player2Id: number; player3Id: number | null; player4Id: number | null };
  callerPlayerIds: number[];
  callerClerkUserId: string;
  /** The session to discard, if the phone had created one. */
  session: { id: number; matchId: number; recordedByClerkUserId: string; status: string } | null;
  sessionRequested: boolean;
  matchId: number;
  /** The unused invite for this match's placeholder opponent, if there is one. */
  unclaimedPlaceholderPlayerId: number | null;
  /** Other recordings of this match that would stay. */
  otherSessionCount: number;
}

export type DiscardPlan =
  | { ok: true; deleteSessionId: number | null; removePlaceholderPlayerId: number | null }
  | { ok: false; status: number; error: string };

export function planDiscard(input: DiscardInput): DiscardPlan {
  const players = [input.match.player1Id, input.match.player2Id, input.match.player3Id, input.match.player4Id].filter(
    (id): id is number => id != null,
  );
  if (!input.callerPlayerIds.some((id) => players.includes(id))) {
    return { ok: false, status: 403, error: "Only the players in this match can discard its recording." };
  }

  let deleteSessionId: number | null = null;
  if (input.sessionRequested) {
    const s = input.session;
    // A session that's already gone counts as discarded, so a retry succeeds.
    if (s) {
      if (s.matchId !== input.matchId || s.recordedByClerkUserId !== input.callerClerkUserId) {
        return { ok: false, status: 403, error: "Only the person who recorded this can discard it." };
      }
      if (s.status !== "recording") {
        return { ok: false, status: 409, error: "This recording is already uploaded, so it can't be discarded here." };
      }
      deleteSessionId = s.id;
    }
  }

  const removePlaceholderPlayerId =
    input.match.leagueId == null && input.unclaimedPlaceholderPlayerId != null && input.otherSessionCount === 0
      ? input.unclaimedPlaceholderPlayerId
      : null;

  return { ok: true, deleteSessionId, removePlaceholderPlayerId };
}
