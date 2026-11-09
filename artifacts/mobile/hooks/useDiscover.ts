// Data for Discover's Players tab, the player card and Discover settings
// (spec: Discover). Every call is free, never Pro.

import { useAuth } from "@clerk/expo";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getGetMyPlayerCardQueryKey } from "@workspace/api-client-react";
import type { FreeRange } from "@workspace/free-times";

import { apiErrorMessage, apiFetch } from "@/lib/api";
import {
  playersPath,
  type DiscoverMe,
  type DiscoverPlayers,
  type Plays,
  type PlayerFilters,
} from "@/lib/discover";

export const discoverKeys = {
  all: ["discover"] as const,
  me: ["discover", "me"] as const,
  players: (radius: number, f: PlayerFilters) =>
    ["discover", "players", radius, f.levels === "mine" ? "mine" : f.levels.join(","), f.plays, f.free] as const,
};

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return (await res.json()) as T;
}

export function useDiscoverMe() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: discoverKeys.me,
    queryFn: async () => json<DiscoverMe>(await apiFetch("/api/discover/me", getToken), "Couldn't load Discover. Try again."),
  });
}

export function useDiscoverPlayers(radius: number, filters: PlayerFilters, enabled = true) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: discoverKeys.players(radius, filters),
    queryFn: async () => json<DiscoverPlayers>(await apiFetch(playersPath(radius, filters), getToken), "Can't load players right now."),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Saves one of your Discover settings, then refreshes Discover. */
function useSaveMe<T>(path: string, method: "PUT", body: (v: T) => unknown, fallback: string) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: T) => json<DiscoverMe>(await apiFetch(path, getToken, { method, body: JSON.stringify(body(v)) }), fallback),
    onSuccess: async (me) => {
      qc.setQueryData(discoverKeys.me, me);
      await qc.invalidateQueries({ queryKey: discoverKeys.all });
    },
  });
}

export function useSetDiscoverArea() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (zip: string) =>
      json<DiscoverMe>(
        await apiFetch("/api/discover/area", getToken, { method: "PUT", body: JSON.stringify({ zip }) }),
        "Couldn't save your area. Try again.",
      ),
    onSuccess: async (me) => {
      qc.setQueryData(discoverKeys.me, me);
      await qc.invalidateQueries({ queryKey: discoverKeys.all });
    },
  });
}

export function useSaveDiscoverSettings() {
  return useSaveMe<{ hidden?: boolean; plays?: Plays | null; radius?: number; matchAlerts?: boolean }>(
    "/api/discover/settings",
    "PUT",
    (v) => v,
    "Couldn't save that. Try again.",
  );
}

/** Saves your free times (decision 156). Also refreshes the player card, which shows them. */
export function useSaveAvailability() {
  const qc = useQueryClient();
  const save = useSaveMe<FreeRange[]>("/api/discover/availability", "PUT", (freeTimes) => ({ freeTimes }), "Couldn't save your times. Try again.");
  return {
    ...save,
    mutateAsync: async (freeTimes: FreeRange[]) => {
      const me = await save.mutateAsync(freeTimes);
      await qc.invalidateQueries({ queryKey: getGetMyPlayerCardQueryKey() });
      return me;
    },
  };
}

/** Saves the distance picked, for next time and the other two tabs. Quiet: the list already shows it. */
export function useSaveRadius() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (radius: number) =>
      json<DiscoverMe>(
        await apiFetch("/api/discover/settings", getToken, { method: "PUT", body: JSON.stringify({ radius }) }),
        "Couldn't save your distance.",
      ),
    onSuccess: (me) => qc.setQueryData(discoverKeys.me, me),
  });
}
