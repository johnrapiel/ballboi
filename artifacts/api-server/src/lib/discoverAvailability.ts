// When you can play (F7, F8, F11): a generic Monday to Sunday week of hours.
// Pure rules, shared by the API routes and tests.
//
// A slot is day * 24 + hour. Day 0 is Monday and 6 is Sunday. Hours run from
// 6 (6 AM) to 21 (9 PM); each slot is the hour that starts then.

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

/** True when two weeks share at least one free hour ("Free when I'm free"). */
export function overlaps(mine: readonly number[], theirs: readonly number[] | null | undefined): boolean {
  if (!mine.length || !theirs?.length) return false;
  const set = new Set(mine);
  return theirs.some((s) => set.has(s));
}

const PERIODS = [
  { name: "mornings", from: 6, to: 11 },
  { name: "afternoons", from: 12, to: 16 },
  { name: "evenings", from: 17, to: 21 },
] as const;

const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A short summary for the player card (F8): "Weekday evenings, weekend
 * mornings". Each part of the day (mornings to 11 AM, afternoons to 4 PM,
 * evenings from 5 PM) names the days it covers: all five weekdays or three
 * or more read "Weekday"; one or two read their names ("Tuesday and Thursday
 * evenings"); the weekend reads "Weekend" or the day. Weekdays come first,
 * then the weekend, earliest part of the day first. Null with no hours.
 */
export function availabilitySummary(slots: readonly number[]): string | null {
  if (!slots.length) return null;
  const daysIn = (period: (typeof PERIODS)[number], days: number[]) =>
    days.filter((d) => slots.some((s) => dayOf(s) === d && hourOf(s) >= period.from && hourOf(s) <= period.to));

  const parts: string[] = [];
  for (const group of ["weekday", "weekend"] as const) {
    for (const p of PERIODS) {
      const days = daysIn(p, group === "weekday" ? WEEKDAYS : WEEKEND);
      if (!days.length) continue;
      if (group === "weekday") {
        parts.push(days.length >= 3 ? `weekday ${p.name}` : `${joinNames(days.map((d) => DAYS[d]))} ${p.name}`);
      } else {
        parts.push(days.length === 2 ? `weekend ${p.name}` : `${DAYS[days[0]]} ${p.name}`);
      }
    }
  }
  if (parts.length > 4) return "Most of the week";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
