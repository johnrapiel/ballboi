import { Appearance } from "react-native";

/**
 * The app's appearance: Light (Day) by default, whatever the iPhone is set to
 * (John, Nov 6, finding #3). app.json sets `userInterfaceStyle: "light"` so the
 * splash and native pieces start in Light; this also forces it at runtime, so
 * Expo Go and every `useColorScheme()` (useColors, date pickers, action sheets,
 * keyboard, status bar) agree.
 *
 * Night stays in the palette (constants/colors.ts) for Wave 2's Appearance
 * setting (finding #4), which will call `setAppAppearance` with the person's
 * choice.
 */
export type AppAppearance = "light" | "dark";

export const DEFAULT_APPEARANCE: AppAppearance = "light";

export function setAppAppearance(appearance: AppAppearance = DEFAULT_APPEARANCE) {
  Appearance.setColorScheme(appearance);
}
