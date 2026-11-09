// Free times (John, Nov 9; spec decision 156, replacing F7's hour grid).
// One generic Monday to Sunday week. Each day has any number of times: the
// three blocks (Morning 7 to 11, Afternoon 12 to 4, Evening 5 to 9) and
// custom ranges typed in words ("6-8pm, 9 to 10 PM").
//
// Pure rules shared by the app and the API: no imports, so both can run them
// and test them in Node.
//
// A time is { day, start, end }: day 0 is Monday and 6 is Sunday; start and
// end are minutes after midnight, end exclusive (1440 is midnight at the end
// of the day). A time that exactly matches a block is that block: there's no
// separate "kind", so converted grids and typed "7 to 11 AM" light the pill.

export interface FreeRange {
  day: number;
  start: number;
  end: number;
}

export type BlockKey = "morning" | "afternoon" | "evening";

export interface Block {
  key: BlockKey;
  name: string;
  start: number;
  end: number;
}

export const BLOCKS: readonly Block[] = [
  { key: "morning", name: "Morning", start: 7 * 60, end: 11 * 60 },
  { key: "afternoon", name: "Afternoon", start: 12 * 60, end: 16 * 60 },
  { key: "evening", name: "Evening", start: 17 * 60, end: 21 * 60 },
];

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Most times one week may hold (about 10 a day). */
export const MAX_TIMES = 70;
const DAY_MINUTES = 24 * 60;

export const blockByKey = (key: BlockKey): Block => BLOCKS.find((b) => b.key === key)!;

/** The block a time exactly matches, or null for a custom time. */
export function blockOf(r: { start: number; end: number }): Block | null {
  return BLOCKS.find((b) => b.start === r.start && b.end === r.end) ?? null;
}

// ─── Words ───────────────────────────────────────────────────────────────────

function clock(min: number): { text: string; pm: boolean } {
  const m = min % DAY_MINUTES;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: mm ? `${h12}:${String(mm).padStart(2, "0")}` : String(h12), pm: h24 >= 12 };
}

/** "6 PM", "6:30 AM", "12 PM" (noon), "12 AM" (midnight). */
export function timeText(min: number): string {
  const c = clock(min);
  return `${c.text} ${c.pm ? "PM" : "AM"}`;
}

/** "6 to 8 PM", "11 AM to 1 PM", "10 PM to 12 AM". */
export function rangeText(r: { start: number; end: number }): string {
  const a = clock(r.start);
  const b = clock(r.end);
  if (a.pm === b.pm && r.end < DAY_MINUTES && r.start < r.end) return `${a.text} to ${b.text} ${b.pm ? "PM" : "AM"}`;
  return `${timeText(r.start)} to ${timeText(r.end)}`;
}

/** The pill's short hours, "7 to 11", as drawn: "Morning 7 to 11". */
export function blockHours(b: Block): string {
  return `${clock(b.start).text} to ${clock(b.end).text}`;
}

/** One time in a list: "Evening, 5 to 9 PM" for a block, "1 to 3 PM" for a custom time. */
export function timeLabel(r: { start: number; end: number }): string {
  const b = blockOf(r);
  return b ? `${b.name}, ${rangeText(b)}` : rangeText(r);
}

// ─── Shape ───────────────────────────────────────────────────────────────────

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function isFreeRange(v: unknown): v is FreeRange {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isInt(r.day) && r.day >= 0 && r.day <= 6 &&
    isInt(r.start) && r.start >= 0 && r.start < DAY_MINUTES &&
    isInt(r.end) && r.end > r.start && r.end <= DAY_MINUTES
  );
}

const order = (a: FreeRange, b: FreeRange) => a.day - b.day || a.start - b.start || a.end - b.end;

/** Sorted by day then start, exact repeats dropped, only { day, start, end }. */
export function normalize(ranges: readonly FreeRange[]): FreeRange[] {
  const out: FreeRange[] = [];
  for (const r of [...ranges].sort(order)) {
    const last = out[out.length - 1];
    if (last && last.day === r.day && last.start === r.start && last.end === r.end) continue;
    out.push({ day: r.day, start: r.start, end: r.end });
  }
  return out;
}

/** What a player saves, or an error in plain words. */
export function parseFreeTimes(raw: unknown): FreeRange[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "Send your free times as a list." };
  if (raw.length > MAX_TIMES) return { error: `That's more than ${MAX_TIMES} times. Combine some and try again.` };
  if (!raw.every(isFreeRange)) return { error: "Each time needs a day, Monday to Sunday, and a start before its end." };
  return normalize(raw);
}

export function sameTimes(a: readonly FreeRange[], b: readonly FreeRange[]): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return x.length === y.length && x.every((r, i) => r.day === y[i].day && r.start === y[i].start && r.end === y[i].end);
}

// ─── The old hour grid ───────────────────────────────────────────────────────

/**
 * The old hour grid (F7), each slot day * 24 + hour, as times. Each run of
 * back-to-back hours on a day becomes one time, so it's exact: 7, 8, 9 and 10
 * AM become 7 to 11 AM (the Morning pill); 6 to 11 AM stays a custom time.
 */
export function rangesFromSlots(slots: readonly number[]): FreeRange[] {
  const hours = [...new Set(slots)]
    .filter((s) => isInt(s) && s >= 0 && s < 7 * 24)
    .sort((a, b) => a - b);
  const out: FreeRange[] = [];
  for (const s of hours) {
    const day = Math.floor(s / 24);
    const start = (s % 24) * 60;
    const last = out[out.length - 1];
    if (last && last.day === day && last.end === start) last.end = start + 60;
    else out.push({ day, start, end: start + 60 });
  }
  return out;
}

/** A player's times: what they saved in the new editor, or their old grid converted. */
export function freeTimesOf(p: { ranges?: readonly FreeRange[] | null; slots?: readonly number[] | null }): FreeRange[] {
  return p.ranges ? normalize(p.ranges) : rangesFromSlots(p.slots ?? []);
}

// ─── Matching and the card summary ───────────────────────────────────────────

/** True when two weeks share any free time on the same day ("Free when I'm free", F8). */
export function overlaps(mine: readonly FreeRange[], theirs: readonly FreeRange[] | null | undefined): boolean {
  if (!mine.length || !theirs?.length) return false;
  return mine.some((a) => theirs.some((b) => a.day === b.day && Math.min(a.end, b.end) > Math.max(a.start, b.start)));
}

/** Hours free in the week, counting overlapping times once. */
export function hoursFree(ranges: readonly FreeRange[]): number {
  let minutes = 0;
  for (let d = 0; d < 7; d++) {
    let reach = 0;
    for (const r of normalize(ranges).filter((x) => x.day === d)) {
      const from = Math.max(r.start, reach);
      if (r.end > from) minutes += r.end - from;
      reach = Math.max(reach, r.end);
    }
  }
  return minutes / 60;
}

// Parts of the day for the summary. Mornings run to noon, afternoons to 5 PM,
// evenings from 5 PM, so a converted grid reads exactly as it did.
const PERIODS = [
  { name: "mornings", from: 0, to: 12 * 60 },
  { name: "afternoons", from: 12 * 60, to: 17 * 60 },
  { name: "evenings", from: 17 * 60, to: DAY_MINUTES },
] as const;

const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A short summary for the player card (F8): "Weekday evenings, weekend
 * mornings". Each part of the day names the days it touches: three or more
 * weekdays read "Weekday"; one or two read their names ("Tuesday and
 * Thursday evenings"); the weekend reads "Weekend" or the day. Weekdays come
 * first, then the weekend, earliest part of the day first; more than four
 * parts read "Most of the week". Null with no times.
 */
export function freeSummary(ranges: readonly FreeRange[]): string | null {
  if (!ranges.length) return null;
  const daysIn = (p: (typeof PERIODS)[number], days: number[]) =>
    days.filter((d) => ranges.some((r) => r.day === d && Math.min(r.end, p.to) > Math.max(r.start, p.from)));

  const parts: string[] = [];
  for (const group of ["weekday", "weekend"] as const) {
    for (const p of PERIODS) {
      const days = daysIn(p, group === "weekday" ? WEEKDAYS : WEEKEND);
      if (!days.length) continue;
      if (group === "weekday") {
        parts.push(days.length >= 3 ? `weekday ${p.name}` : `${joinNames(days.map((d) => DAY_NAMES[d]))} ${p.name}`);
      } else {
        parts.push(days.length === 2 ? `weekend ${p.name}` : `${DAY_NAMES[days[0]]} ${p.name}`);
      }
    }
  }
  if (!parts.length) return null;
  if (parts.length > 4) return "Most of the week";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The Free times sheet: only the days with times, in order.
 * text "Sat: Morning, 7 to 11 AM; 1 to 3 PM"; spoken uses the full day name.
 */
export function dayLines(ranges: readonly FreeRange[]): { day: number; text: string; spoken: string }[] {
  const all = normalize(ranges);
  const out: { day: number; text: string; spoken: string }[] = [];
  for (let d = 0; d < 7; d++) {
    const times = all.filter((r) => r.day === d).map(timeLabel);
    if (!times.length) continue;
    const list = times.join("; ");
    out.push({ day: d, text: `${DAY_SHORT[d]}: ${list}`, spoken: `${DAY_NAMES[d]}: ${list}` });
  }
  return out;
}

// ─── Custom times in words ───────────────────────────────────────────────────

export const CUSTOM_HINT = "Add times, separated by commas. For example: 6 to 8 PM, 9 to 10 PM";
export const TRY_THIS = "Try a time like 6 to 8 PM.";

interface Clock {
  /** Minutes when the time says which half of the day it is (PM, 18:00, noon). */
  fixed: number | null;
  /** The AM and PM readings when it doesn't ("6"). */
  either: [number, number] | null;
}

const TIME = String.raw`(noon|midnight|(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a|p)?)`;
const RANGE = new RegExp(String.raw`^(?:from\s+)?${TIME}\s*(?:-|to|till|til|until|thru|through)\s*${TIME}$`);
const SINGLE = new RegExp(String.raw`^${TIME}$`);

function readClock(word: string | undefined, hh: string | undefined, mm: string | undefined, mer: string | undefined): Clock | null {
  if (word === "noon") return { fixed: 12 * 60, either: null };
  if (word === "midnight") return { fixed: 0, either: null };
  if (hh == null) return null;
  const h = Number(hh);
  const m = mm == null ? 0 : Number(mm);
  if (m > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    const pm = mer.startsWith("p");
    return { fixed: ((h % 12) + (pm ? 12 : 0)) * 60 + m, either: null };
  }
  // 24-hour: past 12, 0, or written with a leading zero ("06:00").
  if (h > 12 || h === 0 || (hh.length === 2 && hh.startsWith("0"))) {
    if (h > 24 || (h === 24 && m > 0)) return null;
    return { fixed: h * 60 + m, either: null };
  }
  return { fixed: null, either: [(h % 12) * 60 + m, ((h % 12) + 12) * 60 + m] };
}

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‒-―−]/g, "-")
    .replace(/\b([ap])\.\s?m\.?/g, "$1m")
    .replace(/\s+/g, " ")
    .trim();
}

export type ParsedPart = { text: string; range: { start: number; end: number } } | { text: string; problem: string };

/** One piece between commas: a time, or what's wrong with it in plain words. */
export function parsePart(text: string): ParsedPart {
  const s = clean(text);
  const quoted = `'${text.trim()}'`;
  const m = RANGE.exec(s);
  if (!m) {
    if (SINGLE.test(s)) return { text, problem: `Add an end time to ${quoted}, like 6 to 8 PM.` };
    return { text, problem: `Couldn't read ${quoted}. ${TRY_THIS}` };
  }
  const a = readClock(m[2] ? undefined : m[1], m[2], m[3], m[4]);
  const b = readClock(m[6] ? undefined : m[5], m[6], m[7], m[8]);
  if (!a || !b) return { text, problem: `Couldn't read ${quoted}. ${TRY_THIS}` };

  const asEnd = (min: number) => (min === 0 ? DAY_MINUTES : min);
  let start: number | null = null;
  let end: number | null = null;
  if (a.fixed != null && b.fixed != null) {
    start = a.fixed;
    end = asEnd(b.fixed);
  } else if (a.fixed != null && b.either) {
    // "9am-12": the end is the first reading after the start.
    start = a.fixed;
    const after = b.either.map(asEnd).filter((e) => e > a.fixed!);
    end = after.length ? Math.min(...after) : asEnd(b.either[0]);
  } else if (a.either && b.fixed != null) {
    // "6-8pm", "11-1pm": the start is the last reading before the end.
    end = asEnd(b.fixed);
    const before = a.either.filter((x) => x < end!);
    start = before.length ? Math.max(...before) : a.either[1];
  } else {
    return { text, problem: `Add AM or PM to ${quoted}, like 6 to 8 PM.` };
  }
  if (start >= DAY_MINUTES) return { text, problem: `Couldn't read ${quoted}. ${TRY_THIS}` };
  if (end === start) return { text, problem: `${quoted} starts and ends at the same time. ${TRY_THIS}` };
  if (end < start) return { text, problem: `${quoted} runs past midnight. End it by 12 AM and add the rest to the next day.` };
  return { text, range: { start, end } };
}

/**
 * Custom times typed in words, separated by commas: "6-8pm, 9 to 10 PM",
 * "18:00-20:00". Returns every time it read and, for anything it couldn't,
 * a problem naming that part ("Couldn't read 'after work'. Try a time like
 * 6 to 8 PM.").
 */
export function parseCustom(input: string): { ranges: { start: number; end: number }[]; problems: string[] } {
  const parts = input
    .split(/[,;\n]|\band\b|&/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const ranges: { start: number; end: number }[] = [];
  const problems: string[] = [];
  for (const p of parts) {
    const r = parsePart(p);
    if ("range" in r) ranges.push(r.range);
    else problems.push(r.problem);
  }
  return { ranges, problems };
}
