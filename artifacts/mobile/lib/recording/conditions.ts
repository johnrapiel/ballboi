// Conditions at stop (shot tracker test plan section 3): one optional row on
// the score prompt, so the eval can slice results by indoor or outdoor, day
// or night, and surface. Skippable, and it never blocks saving the score.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/conditions.test.ts.

import type { Conditions } from "@/lib/recording/sidecar";

export type { Conditions };

export const NO_CONDITIONS: Conditions = { setting: null, light: null, surface: null };

export interface ConditionGroup<K extends keyof Conditions = keyof Conditions> {
  key: K;
  /** Read by VoiceOver before the chips, and shown as the group's label. */
  label: string;
  options: { value: NonNullable<Conditions[K]>; label: string }[];
}

export const CONDITION_GROUPS: ConditionGroup[] = [
  {
    key: "setting",
    label: "Court",
    options: [
      { value: "indoor", label: "Indoor" },
      { value: "outdoor", label: "Outdoor" },
    ],
  },
  {
    key: "light",
    label: "Light",
    options: [
      { value: "day", label: "Day" },
      { value: "night", label: "Night" },
    ],
  },
  {
    key: "surface",
    label: "Surface",
    options: [
      { value: "hard", label: "Hard" },
      { value: "clay", label: "Clay" },
      { value: "grass", label: "Grass" },
      { value: "other", label: "Other" },
    ],
  },
] as ConditionGroup[];

/** Tapping a chip picks it; tapping the picked chip again clears that group. */
export function toggleCondition(c: Conditions, key: keyof Conditions, value: string): Conditions {
  return { ...c, [key]: c[key] === value ? null : value } as Conditions;
}

/** Nothing picked: the same as skipping. */
export function isEmpty(c: Conditions | null | undefined): boolean {
  return !c || (!c.setting && !c.light && !c.surface);
}

/** What's sent and saved: null when nothing was picked. */
export function conditionsToSave(c: Conditions): Conditions | null {
  return isEmpty(c) ? null : c;
}
