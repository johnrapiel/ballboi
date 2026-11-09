// Free times (John, Nov 9; spec decision 156, replacing the F7 hour grid).
// The editor's pure helpers: the rules themselves (blocks, parsing custom
// times, the card summary, matching) live in @workspace/free-times, shared
// with the API. No React Native here, so it's testable in Node.

import {
  DAY_NAMES,
  blockOf,
  normalize,
  parseCustom,
  rangeText,
  type Block,
  type BlockKey,
  type FreeRange,
} from "@workspace/free-times";

export { BLOCKS, CUSTOM_HINT, DAY_NAMES, blockHours, dayLines, rangeText, sameTimes } from "@workspace/free-times";
export type { Block, BlockKey, FreeRange } from "@workspace/free-times";

/** What one day's row shows: which blocks are on, and its custom times in order. */
export function dayTimes(ranges: readonly FreeRange[], day: number): { on: Record<BlockKey, boolean>; custom: FreeRange[] } {
  const mine = normalize(ranges).filter((r) => r.day === day);
  const on = { morning: false, afternoon: false, evening: false } as Record<BlockKey, boolean>;
  const custom: FreeRange[] = [];
  for (const r of mine) {
    const b = blockOf(r);
    if (b) on[b.key] = true;
    else custom.push(r);
  }
  return { on, custom };
}

const same = (a: FreeRange, b: FreeRange) => a.day === b.day && a.start === b.start && a.end === b.end;

/** A block pill tapped: on if it was off, off if it was on. */
export function toggleBlock(ranges: readonly FreeRange[], day: number, block: Block): FreeRange[] {
  const r = { day, start: block.start, end: block.end };
  return ranges.some((x) => same(x, r)) ? ranges.filter((x) => !same(x, r)) : normalize([...ranges, r]);
}

export function removeTime(ranges: readonly FreeRange[], r: FreeRange): FreeRange[] {
  return ranges.filter((x) => !same(x, r));
}

/** A day's open Custom field: what's typed, and the custom time it's editing, if any. */
export interface CustomField {
  text: string;
  editing: FreeRange | null;
}

/**
 * Custom text added to a day. Every part has to read, or nothing changes and
 * `problems` says which part didn't ("Couldn't read 'after work'. Try a time
 * like 6 to 8 PM."). Editing a time replaces it. A typed time that matches a
 * block ("7 to 11 AM") turns that block on.
 */
export function applyCustom(
  ranges: readonly FreeRange[],
  day: number,
  field: CustomField,
): { ranges: FreeRange[]; problems: string[] } {
  const { ranges: read, problems } = parseCustom(field.text);
  if (problems.length) return { ranges: [...ranges], problems };
  const kept = field.editing ? removeTime(ranges, field.editing) : [...ranges];
  return { ranges: normalize([...kept, ...read.map((r) => ({ day, ...r }))]), problems: [] };
}

/**
 * The week as Save would send it, with every open Custom field added. Save
 * stays off while any field has a part that can't be read.
 */
export function withFields(
  ranges: readonly FreeRange[],
  fields: Readonly<Record<number, CustomField>>,
): { ranges: FreeRange[]; problems: Record<number, string[]> } {
  let out = normalize(ranges);
  const problems: Record<number, string[]> = {};
  for (const [d, field] of Object.entries(fields)) {
    const day = Number(d);
    if (!field.text.trim()) continue;
    const r = applyCustom(out, day, field);
    if (r.problems.length) problems[day] = r.problems;
    else out = r.ranges;
  }
  return { ranges: out, problems };
}

/** The first day with something that can't be read, or null. */
export function firstProblemDay(problems: Readonly<Record<number, string[]>>): number | null {
  const days = Object.keys(problems).map(Number).sort((a, b) => a - b);
  return days.length ? days[0] : null;
}

/** Save's hint while it's off: "Fix the times on Wednesday first", or nothing changed yet. */
export function saveHint(problems: Readonly<Record<number, string[]>>, dirty: boolean): string | undefined {
  const day = firstProblemDay(problems);
  if (day != null) return `Fix the times on ${DAY_NAMES[day]} first`;
  return dirty ? undefined : "Pick or change a time first";
}

/** A block pill for VoiceOver: "Morning, 7 to 11 AM, Tuesday". The selected state is read on its own. */
export function blockSpoken(b: Block, day: number): string {
  return `${b.name}, ${rangeText(b)}, ${DAY_NAMES[day]}`;
}

/** A custom time's pill for VoiceOver: "6 to 8 PM, Wednesday". */
export function customSpoken(r: FreeRange): string {
  return `${rangeText(r)}, ${DAY_NAMES[r.day]}`;
}

/** What the Custom field starts with when you tap a custom time to edit it. */
export const editText = (r: FreeRange) => rangeText(r);

/** The Free times sheet's first line, and the card's Free times for VoiceOver. */
export function freeTimesLine(summary: string | null | undefined, you: boolean): string {
  if (!summary) return you ? "You haven't added free times yet." : "No free times added yet.";
  // Day names keep their capital: "Free Tuesday evenings", "Free weekday evenings".
  const first = summary.split(" ")[0];
  const day = (DAY_NAMES as readonly string[]).includes(first);
  return `Free ${day ? summary : summary.charAt(0).toLowerCase() + summary.slice(1)}`;
}
