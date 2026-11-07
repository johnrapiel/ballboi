// Match cards in a chat (F2): the cards with a player, sending one, and
// answering one. Refreshes every 30 seconds while the chat is open, so the
// other player's answer shows up.

import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";
import type { MatchPlan, PlanAction } from "@/lib/discover";

export const planKeys = {
  all: ["match-plans"] as const,
  with: (userId: number) => ["match-plans", "with", userId] as const,
  upcoming: ["match-plans", "upcoming"] as const,
};

export interface PlansWithUser {
  otherName: string;
  blocked: boolean;
  devTools: boolean;
  plans: MatchPlan[];
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return (await res.json()) as T;
}

export function useMatchPlans(userId: number | null) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: planKeys.with(userId ?? 0),
    queryFn: async () => json<PlansWithUser>(await apiFetch(`/api/match-plans/with/${userId}`, getToken), "Can't load match cards."),
    enabled: userId != null && userId > 0,
    refetchInterval: 30_000,
  });
}

export function useUpcomingMatchPlans() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: planKeys.upcoming,
    queryFn: async () =>
      json<{ matches: (MatchPlan & { otherName: string; otherUserId: number | null })[] }>(
        await apiFetch("/api/match-plans/upcoming", getToken),
        "Can't load your matches.",
      ),
  });
}

export function useSendMatchPlan() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: number;
      startsAt: string;
      timeZone: string;
      courtId: number | null;
      kind: "singles" | "practice";
    }) =>
      json<MatchPlan>(
        await apiFetch("/api/match-plans", getToken, { method: "POST", body: JSON.stringify(input) }),
        "Couldn't send the match card.",
      ),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

/** Commands the server takes, by the answer a card shows. */
const COMMAND: Partial<Record<PlanAction, string>> = {
  accept: "accept",
  decline: "decline",
  undo: "undo",
  still_on: "still-on",
  cancel: "cancel",
  not_played: "not-played",
  no_show: "no-show",
  dispute: "dispute",
  admit: "admit",
};

export function usePlanAction() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, action }: { planId: number; action: PlanAction }) => {
      const command = COMMAND[action];
      if (!command) throw new Error("That isn't possible here.");
      return json<MatchPlan>(
        await apiFetch(`/api/match-plans/${planId}/${command}`, getToken, { method: "POST" }),
        "Couldn't do that. Try again.",
      );
    },
    onSettled: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: planKeys.all }), qc.invalidateQueries({ queryKey: ["discover"] })]);
    },
  });
}

/** Dev builds and dev servers only: move a card's times closer by some hours. */
export function useShiftPlan() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, hours }: { planId: number; hours: number }) =>
      json<MatchPlan>(
        await apiFetch(`/api/dev/match-plans/${planId}/shift`, getToken, { method: "POST", body: JSON.stringify({ hours }) }),
        "Couldn't move the match.",
      ),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}
