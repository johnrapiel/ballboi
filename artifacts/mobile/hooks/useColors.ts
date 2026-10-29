import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

/**
 * Returns the Ball Boi design system colors for the device's appearance:
 * Day session (light) or Night session (dark). Includes the design system
 * names (paper, ink, court...) plus legacy keys for screens not yet rebuilt.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
