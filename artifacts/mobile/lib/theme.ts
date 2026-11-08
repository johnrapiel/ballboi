import colors from "@/constants/colors";

/**
 * The app's appearance (John, Nov 7 and 8): it follows the iPhone's Light or
 * Dark Mode, with no in-app override. Light Mode is Day (ivory and white,
 * navy ink); Dark Mode is Night (warm charcoal, ivory ink). It switches live
 * when the phone switches.
 *
 * One exception: a shareable recap always uses the Day look, whatever the
 * phone is set to. Code that renders one wraps it in `<DayLook>`
 * (components/DayLook.tsx), which `useColors` respects.
 *
 * Pure, so it's unit tested in Node (lib/__tests__/theme.test.ts).
 */
export type Scheme = "light" | "dark";

/**
 * The scheme a part of the app draws in: an override (a recap's Day look)
 * wins, otherwise the iPhone's appearance. Anything the phone reports other
 * than "dark" (light, or unknown before the first read) is Day.
 */
export function resolveScheme(system: string | null | undefined, override?: Scheme | null): Scheme {
  if (override) return override;
  return system === "dark" ? "dark" : "light";
}

/**
 * The design system colors for a scheme. With iOS Increase Contrast on, muted
 * text and hairlines switch to their -hc tokens.
 */
export function paletteFor(scheme: Scheme, increaseContrast: boolean) {
  const palette = scheme === "dark" ? colors.dark : colors.light;
  if (!increaseContrast) return { ...palette, radius: colors.radius };
  return {
    ...palette,
    inkMuted: palette.inkMutedHc,
    mutedForeground: palette.inkMutedHc,
    hairline: palette.hairlineHc,
    border: palette.hairlineHc,
    hairlineStrong: palette.hairlineStrongHc,
    input: palette.hairlineStrongHc,
    radius: colors.radius,
  };
}
