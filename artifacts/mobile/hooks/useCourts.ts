// The court directory (F4): search, add a court, and your home court. A
// small in-memory "picked court" lets Post an open match read back the court
// chosen on the directory screen.

import { useAuth } from "@clerk/expo";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";

import { discoverKeys } from "@/hooks/useDiscover";
import { apiErrorMessage, apiFetch } from "@/lib/api";
import { courtsPath, type CourtCard } from "@/lib/discover";

export const courtKeys = {
  all: ["courts"] as const,
  list: (q: string) => ["courts", "list", q] as const,
  home: ["courts", "home"] as const,
};

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return (await res.json()) as T;
}

export function useCourts(query: string) {
  const { getToken } = useAuth();
  const [q, setQ] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), query.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);
  const result = useQuery({
    queryKey: courtKeys.list(q),
    queryFn: async () =>
      json<{ courts: CourtCard[]; homeCourtId: number | null }>(await apiFetch(courtsPath(q), getToken), "Can't load courts right now."),
    placeholderData: keepPreviousData,
  });
  return { ...result, searching: q !== query.trim() || (result.isFetching && result.isPlaceholderData) };
}

export function useHomeCourt() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: courtKeys.home,
    queryFn: async () => json<{ court: CourtCard | null }>(await apiFetch("/api/courts/home", getToken), "Can't load your home court."),
  });
}

export function useSetHomeCourt() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (courtId: number | null) =>
      json<{ court: CourtCard | null }>(
        await apiFetch("/api/courts/home", getToken, { method: "PUT", body: JSON.stringify({ courtId }) }),
        "Couldn't save your home court. Try again.",
      ),
    onSuccess: async (data) => {
      qc.setQueryData(courtKeys.home, data);
      await Promise.all([qc.invalidateQueries({ queryKey: courtKeys.all }), qc.invalidateQueries({ queryKey: discoverKeys.all })]);
    },
  });
}

export function useAddCourt() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; address: string }) =>
      json<CourtCard & { existing: boolean }>(
        await apiFetch("/api/courts", getToken, { method: "POST", body: JSON.stringify(input) }),
        "Couldn't add the court. Try again.",
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: courtKeys.all });
    },
  });
}

// ─── A court picked for a form (Post an open match) ─────────────────────────

/** undefined: nothing picked yet. null: "Court not set". */
let picked: CourtCard | null | undefined;
const listeners = new Set<() => void>();
export const courtPick = {
  set(c: CourtCard | null) {
    picked = c;
    listeners.forEach((l) => l());
  },
  clear() {
    picked = undefined;
    listeners.forEach((l) => l());
  },
};
export function usePickedCourt(): CourtCard | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => picked,
  );
}
