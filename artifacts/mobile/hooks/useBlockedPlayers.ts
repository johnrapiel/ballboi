// Players you've blocked, and unblocking them. Uses the existing safety API:
// GET /api/blocks and DELETE /api/players/:playerId/block.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface BlockedPlayer {
  /** Null only if the blocked account has no player record; then it can't be unblocked here. */
  playerId: number | null;
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
  return async (player: BlockedPlayer & { playerId: number }) => {
    let res: Response;
    try {
      res = await apiFetch(`/api/players/${player.playerId}/block`, getToken, { method: "DELETE" });
    } catch {
      throw new Error("Check your connection and try again.");
    }
    if (!res.ok) throw new Error(await apiErrorMessage(res, "Try again in a moment."));
    // Take them off the list now, then refresh what else depends on blocks.
    qc.setQueryData<BlockedPlayer[]>(blockedPlayersKey, (list) => list?.filter((p) => p.playerId !== player.playerId));
    void qc.invalidateQueries({ queryKey: ["messages"] });
  };
}
