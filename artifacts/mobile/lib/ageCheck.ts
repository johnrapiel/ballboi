// Age check helpers. Only the pass flag is ever stored; birth dates aren't.

export const AGE_CHECK_PASSED = "passed";

export function isAgeCheckPassed(metadata: unknown): boolean {
  return (metadata as { ageCheck?: unknown } | null | undefined)?.ageCheck === AGE_CHECK_PASSED;
}

/** Earliest date the birthday wheels allow. */
export const EARLIEST_BIRTH_DATE = new Date(1900, 0, 1);

/**
 * Where the birthday wheels start before anyone touches them: January 1,
 * 30 years ago. Spec: the wheel never starts at exactly 18 years ago, so the
 * cutoff isn't hinted and tapping Done without scrolling doesn't pass the check.
 */
export function neutralStartDate(today: Date): Date {
  return new Date(today.getFullYear() - 30, 0, 1);
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

/** "March 4, 1990", in the person's locale. */
export function formatBirthday(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
