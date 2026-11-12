// One time format across the app (spec decision 180, John, Nov 11).
// Every time shows AM or PM: "7 AM", "6:30 PM" (no ":00", a space before
// AM or PM, capitals). Ranges read "7 to 11 AM", or "10 AM to 12 PM" when
// they cross noon. The words come from @workspace/free-times so the free
// times editor, the card and the API all say times the same way.
// No React Native here, so it's testable in Node.

import { rangeText, timeText } from "@workspace/free-times";

export { rangeText, timeText };

/** "7 AM" or "6:30 PM" for a moment, on the phone's clock. */
export function clockTime(d: Date): string {
  return timeText(d.getHours() * 60 + d.getMinutes());
}

/** "6:30 PM" for a stored "HH:MM" (a league's weekly match time), or null if it doesn't read. */
export function hhmmTime(hhmm: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return timeText(h * 60 + min);
}
