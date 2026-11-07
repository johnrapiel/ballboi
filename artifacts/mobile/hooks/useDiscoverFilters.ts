// Discover's filters and distance, shared by the tab and its sheets (Filters,
// Custom distance). Kept in memory for the session; the distance is also
// saved on the server so it's the same next time and on all three tabs.

import { useSyncExternalStore } from "react";

import { DEFAULT_FILTERS, DEFAULT_RADIUS, type DiscoverTab, type PlayerFilters } from "@/lib/discover";

interface DiscoverState {
  tab: DiscoverTab;
  radius: number;
  /** True once the radius came from the server, so it isn't reset under you. */
  radiusLoaded: boolean;
  filters: PlayerFilters;
}

let state: DiscoverState = { tab: "players", radius: DEFAULT_RADIUS, radiusLoaded: false, filters: DEFAULT_FILTERS };
const listeners = new Set<() => void>();

function set(patch: Partial<DiscoverState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDiscoverState(): DiscoverState {
  return useSyncExternalStore(subscribe, () => state);
}

export const discoverState = {
  get: () => state,
  setTab: (tab: DiscoverTab) => set({ tab }),
  setRadius: (radius: number) => set({ radius, radiusLoaded: true }),
  /** The saved distance, once, when Discover first loads. */
  loadRadius: (radius: number) => {
    if (!state.radiusLoaded) set({ radius, radiusLoaded: true });
  },
  setFilters: (filters: PlayerFilters) => set({ filters }),
};
