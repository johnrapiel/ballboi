// The old "When you can play" hour grid (F7): a generic Monday to Sunday
// week of hours. Free times (decision 156) replaced it with times in
// @workspace/free-times; this file keeps the grid's shape so old saves and old
// app versions still work, and reads them through the new rules.
//
// A slot is day * 24 + hour. Day 0 is Monday and 6 is Sunday. Hours run from
// 6 (6 AM) to 21 (9 PM); each slot is the hour that starts then.

import { freeSummary, freeTimesOf, overlaps as timesOverlap, rangesFromSlots, type FreeRange } from "@workspace/free-times";

export const FIRST_HOUR = 6;
export const LAST_HOUR = 21;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const slotOf = (day: number, hour: number) => day * 24 + hour;
export const dayOf = (slot: number) => Math.floor(slot / 24);
export const hourOf = (slot: number) => slot % 24;

export function isSlot(v: unknown): v is number {
  if (typeof v !== "number" || !Number.isInteger(v)) return false;
  const d = dayOf(v);
  const h = hourOf(v);
  return d >= 0 && d <= 6 && h >= FIRST_HOUR && h <= LAST_HOUR;
}

/** The slots a player saves, sorted and without repeats. An error for anything outside the grid. */
export function parseSlots(raw: unknown): number[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "Send the hours you're free as a list." };
  if (raw.length > 7 * 24) return { error: "That's more hours than a week has." };
  if (!raw.every(isSlot)) return { error: "Pick hours from 6 AM to 9 PM, Monday to Sunday." };
  return [...new Set(raw as number[])].sort((a, b) => a - b);
}

/** A player's times: saved in the new editor, or their old hour grid converted exactly. */
export function timesOf(p: { slots?: readonly number[] | null; freeTimes?: readonly FreeRange[] | null }): FreeRange[] {
  return freeTimesOf({ ranges: p.freeTimes, slots: p.slots });
}

/** True when two old hour grids share a free hour, read through the new times ("Free when I'm free"). */
export function overlaps(mine: readonly number[], theirs: readonly number[] | null | undefined): boolean {
  return timesOverlap(rangesFromSlots(mine), rangesFromSlots(theirs ?? []));
}

/** The card summary for an old hour grid: "Weekday evenings, weekend mornings" (F8). */
export function availabilitySummary(slots: readonly number[]): string | null {
  return freeSummary(rangesFromSlots(slots));
}
