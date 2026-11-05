// Discover's filters (spec: Discover), shared by the Discover tab and its
// Filters sheet. Kept on the phone, so they stick after the app closes.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DiscoverFilters } from "@workspace/api-client-react";
import { useEffect, useSyncExternalStore } from "react";

import { DEFAULT_FILTERS, readSavedFilters } from "@/lib/discover";

const KEY = "ballboi.discover.filters";
let value: DiscoverFilters = DEFAULT_FILTERS;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      value = readSavedFilters(raw);
      emit();
    })
    .catch(() => {
      // Defaults for this launch.
    });
  return loading;
}

export function setDiscoverFilters(next: Partial<DiscoverFilters>) {
  value = { ...value, ...next };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => {
    // Kept for this launch.
  });
}

export function resetDiscoverFilters() {
  setDiscoverFilters(DEFAULT_FILTERS);
}

export function useDiscoverFilters(): DiscoverFilters {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => value,
    () => value,
  );
}
