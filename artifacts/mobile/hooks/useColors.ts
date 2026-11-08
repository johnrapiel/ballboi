import { createContext, useContext } from "react";
import { useColorScheme } from "react-native";

import { useAccessibilitySettings } from "@/hooks/useAccessibilitySettings";
import { paletteFor, resolveScheme, type Scheme } from "@/lib/theme";

/**
 * A fixed scheme for a subtree, whatever the iPhone is set to. Only the Day
 * look for shareable recaps uses it: wrap the recap in `<DayLook>`
 * (components/DayLook.tsx). Null everywhere else, so the app follows the phone.
 */
export const SchemeOverride = createContext<Scheme | null>(null);

/**
 * The scheme this part of the app draws in: the iPhone's Light or Dark Mode,
 * or Day inside `<DayLook>`. Use it for native pieces that take a scheme
 * (date picker `themeVariant`, Liquid Glass `colorScheme`, blur tint), so they
 * always match the colors from `useColors`.
 */
export function useScheme(): Scheme {
  const system = useColorScheme();
  const override = useContext(SchemeOverride);
  return resolveScheme(system, override);
}

/**
 * Returns the Ball Boi design system colors for the app's appearance (see
 * lib/theme.ts): Day in Light Mode, Night in Dark Mode, switching live when
 * the phone switches. Includes the design system names (paper, ink, court...)
 * plus legacy keys for screens not yet rebuilt.
 *
 * With iOS Increase Contrast on, muted text and hairlines switch to their
 * -hc tokens, so every screen gets the stronger values without changes.
 */
export function useColors() {
  const scheme = useScheme();
  const { increaseContrast } = useAccessibilitySettings();
  return paletteFor(scheme, increaseContrast);
}
