// Players you've blocked, and unblocking them. Uses the existing safety API:
// GET /api/blocks and DELETE /api/players/:playerId/block, or
// DELETE /api/discover/players/:userId/block for a Discover player who isn't
// in a league.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface BlockedPlayer {
  /** Null when the blocked account has no league player (a Discover player). */
  playerId: number | null;
  /** The account's user id; unblocks a Discover player with no league player. */
  userId: number | null;
  name: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export const blockedPlayersKey = ["blocks"] as const;

export function useBlockedPlayers() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: blockedPlayersKey,
    queryFn: async (): Promise<BlockedPlayer[]> => {
      let res: Response;
      try {
        res = await apiFetch("/api/blocks", getToken);
      } catch {
        throw new Error("Check your connection and try again.");
      }
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Try again in a moment."));
      return (await res.json()) as BlockedPlayer[];
    },
  });
}

export function useUnblock() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return async (player: BlockedPlayer) => {
    const path =
      player.playerId != null ? `/api/players/${player.playerId}/block` : `/api/discover/players/${player.userId}/block`;
    let res: Response;
    try {
      res = await apiFetch(path, getToken, { method: "DELETE" });
    } catch {
      throw new Error("Check your connection and try again.");
    }
    if (!res.ok) throw new Error(await apiErrorMessage(res, "Try again in a moment."));
    // Take them off the list now, then refresh what else depends on blocks.
    qc.setQueryData<BlockedPlayer[]>(blockedPlayersKey, (list) =>
      list?.filter((p) => !(p.playerId === player.playerId && p.userId === player.userId)),
    );
    void qc.invalidateQueries({ queryKey: ["messages"] });
    void qc.invalidateQueries({ queryKey: ["/api/discover/players"] });
  };
}
