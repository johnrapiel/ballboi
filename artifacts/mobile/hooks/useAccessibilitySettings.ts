import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The iOS display settings the design system responds to:
 * - boldText: Settings > Accessibility > Display & Text Size > Bold Text.
 *   Custom fonts ignore it on their own, so Text swaps to a heavier face.
 * - increaseContrast: Display & Text Size > Increase Contrast.
 *   useColors swaps hairlines and muted text for their -hc tokens.
 *
 * One shared subscription for the whole app, read with useSyncExternalStore.
 */
export interface AccessibilitySettings {
  boldText: boolean;
  increaseContrast: boolean;
}

let current: AccessibilitySettings = { boldText: false, increaseContrast: false };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<AccessibilitySettings>) {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  AccessibilityInfo.isBoldTextEnabled()
    .then((boldText) => set({ boldText }))
    .catch(() => {});
  AccessibilityInfo.isDarkerSystemColorsEnabled()
    .then((increaseContrast) => set({ increaseContrast }))
    .catch(() => {});
  AccessibilityInfo.addEventListener("boldTextChanged", (boldText) => set({ boldText }));
  AccessibilityInfo.addEventListener("darkerSystemColorsChanged", (increaseContrast) =>
    set({ increaseContrast }),
  );
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAccessibilitySettings(): AccessibilitySettings {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
