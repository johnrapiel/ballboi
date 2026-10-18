// Age check helpers. Only the pass flag is ever stored; birth dates aren't.

export const AGE_CHECK_PASSED = "passed";

export function isAgeCheckPassed(metadata: unknown): boolean {
  return (metadata as { ageCheck?: unknown } | null | undefined)?.ageCheck === AGE_CHECK_PASSED;
}

/** Parses month/day/year fields into a real calendar date, or null. */
export function parseBirthDate(month: string, day: string, year: string): Date | null {
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(y, m - 1, d);
  // Rejects dates that roll over, like Feb 30.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Whole years between birth and `today`. */
export function ageOn(birth: Date, today: Date): number {
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
