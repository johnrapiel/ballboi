import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { useAccessibilitySettings } from "@/hooks/useAccessibilitySettings";

/**
 * Returns the Ball Boi design system colors for the device's appearance:
 * Day session (light) or Night session (dark). Includes the design system
 * names (paper, ink, court...) plus legacy keys for screens not yet rebuilt.
 *
 * With iOS Increase Contrast on, muted text and hairlines switch to their
 * -hc tokens, so every screen gets the stronger values without changes.
 */
export function useColors() {
  const scheme = useColorScheme();
  const { increaseContrast } = useAccessibilitySettings();
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
