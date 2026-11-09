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
 * cutoff isn't hinted. Done stays off until a wheel moves (app/age-check.tsx),
 * so the untouched start date can't pass the check.
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

// Apple's age range (Declared Age Range, iOS 26 and later; Wave 2 Session G,
// acceptance 36). Before the birthday step, iOS asks the person whether to
// share their age range with Ball Boi. Shared and 18 or over: straight past
// the birthday step. Shared and under 18: "Ball Boi is 18+ for now" and no
// account. Not shared, not available, or an error: the birthday step, as
// before. Only the pass flag is ever stored, never the range.

export const AGE_GATE = 18;

/** The fields of Apple's answer this check reads. */
export interface AppleAgeRange {
  lowerBound: number | null;
  upperBound: number | null;
}

export type AgeRangeOutcome = "adult" | "under18" | "askBirthday";

/** What Apple's answer means for sign-up. Anything unclear asks for the birthday. */
export function ageRangeOutcome(range: AppleAgeRange | null | undefined): AgeRangeOutcome {
  if (!range) return "askBirthday";
  if (range.lowerBound != null && range.lowerBound >= AGE_GATE) return "adult";
  if (range.upperBound != null && range.upperBound < AGE_GATE) return "under18";
  return "askBirthday";
}

/**
 * Apple's age range is only asked on iOS 26 or later. On earlier versions the
 * module answers as if the person were an adult, so it must never be asked there.
 */
export function canAskAppleAgeRange(os: string, version: string | number): boolean {
  if (os !== "ios") return false;
  const major = Number.parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 26;
}
