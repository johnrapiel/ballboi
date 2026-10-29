// Ball Boi recording endpoints that aren't in the generated client.
// Server: artifacts/api-server/src/routes/recording.ts.

import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface RecordableMatch {
  id: number;
  scheduledAt: string | null;
  location: string | null;
  leagueId: number | null;
  leagueName: string | null;
  format: "singles" | "doubles";
  opponentName: string;
  partnerName: string | null;
}

/** Start and end of the phone's local day. */
export function localDay(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from, to };
}

export const todaysMatchesKey = ["recording", "todays-matches"] as const;

/** The signed-in player's unplayed matches today, earliest first. */
export function useTodaysMatches() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: todaysMatchesKey,
    queryFn: async (): Promise<RecordableMatch[]> => {
      const { from, to } = localDay();
      const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      const res = await apiFetch(`/api/recording/todays-matches?${qs}`, getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load today's matches."));
      return (await res.json()) as RecordableMatch[];
    },
  });
}

/** "6:00 PM", or null when there's no time. */
export function matchTime(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
