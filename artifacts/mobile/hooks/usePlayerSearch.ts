// The one player search behind Quick match and New message (findings #15
// and #18). Searches a moment after typing stops, and keeps the last results
// on screen while the next ones load so the list doesn't flash.

import { useAuth } from "@clerk/expo";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiErrorMessage, apiFetch } from "@/lib/api";
import { SEARCH_DEBOUNCE_MS, searchPath, type PlayerSearchResponse } from "@/lib/playerSearch";

export const playerSearchKey = (q: string) => ["players", "search", q] as const;

export function usePlayerSearch(query: string) {
  const { getToken } = useAuth();
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const next = query.trim();
    // Clearing the field shows the full list straight away.
    if (!next) {
      setDebounced("");
      return;
    }
    const t = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const result = useQuery({
    queryKey: playerSearchKey(debounced),
    queryFn: async (): Promise<PlayerSearchResponse> => {
      const res = await apiFetch(searchPath(debounced), getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't search players. Try again."));
      return (await res.json()) as PlayerSearchResponse;
    },
    placeholderData: keepPreviousData,
  });

  /** True while typing or fetching: the list shown is for an older search. */
  const searching = debounced !== query.trim() || (result.isFetching && result.isPlaceholderData);
  return { ...result, searching, query: debounced };
}
