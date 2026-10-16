// Ball Boi design tokens for iOS. Mirrors the web app's AA palette
// (artifacts/tennis-league/src/index.css). Every text/background pair used
// in the app is listed in CONTRAST_PAIRS and checked by src/theme/contrast.ts.

export const palette = {
  courtCream: "#F5F0E8",
  courtIvory: "#EDE8DC",
  netWhite: "#FFFFFF",
  inkNavy: "#1A2744",
  inkNavyMid: "#2E3F6B",
  tealAce: "#00B4A0", // decorative + dark mode only
  tealAceDeep: "#00766A", // AA text and fills in light mode
  warmGray: "#67625A",
  nightBase: "#0F1520",
  nightSurface: "#192032",
  nightSubtle: "#1E2840",
  nightText: "#EEE9DF",
  nightMuted: "#8A99B5",
} as const;

export type ColorScheme = "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  subtle: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  border: string;
  focus: string;
  destructive: string;
  onDestructive: string;
  warning: string;
  success: string;
  info: string;
}

export const colors: Record<ColorScheme, ThemeColors> = {
  light: {
    background: palette.courtCream,
    surface: palette.netWhite,
    subtle: palette.courtIvory,
    text: palette.inkNavy,
    textMuted: palette.warmGray,
    primary: palette.tealAceDeep,
    onPrimary: palette.netWhite,
    border: "#D9D2C5",
    focus: palette.tealAceDeep,
    destructive: "#B03526",
    onDestructive: palette.netWhite,
    warning: "#8A5A00",
    success: "#1B7149",
    info: "#2456A6",
  },
  dark: {
    background: palette.nightBase,
    surface: palette.nightSurface,
    subtle: palette.nightSubtle,
    text: palette.nightText,
    textMuted: palette.nightMuted,
    primary: palette.tealAce,
    onPrimary: palette.nightBase,
    border: "#2C3650",
    focus: palette.tealAce,
    destructive: "#F2857A",
    onDestructive: palette.nightBase,
    warning: "#F2C14E",
    success: "#4CC38A",
    info: "#8AB0EC",
  },
};

// Text styles use Dynamic Type: never set allowFontScaling={false}.
// Sizes are the defaults at the "Large" content size; iOS scales them.
export const typography = {
  display: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 34, lineHeight: 41 },
  title: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, lineHeight: 28 },
  headline: { fontFamily: "DMSans_700Bold", fontSize: 17, lineHeight: 22 },
  body: { fontFamily: "DMSans_400Regular", fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: "DMSans_400Regular", fontSize: 16, lineHeight: 21 },
  footnote: { fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 18 },
  label: { fontFamily: "DMMono_500Medium", fontSize: 12, lineHeight: 16, letterSpacing: 0.8 },
  stat: { fontFamily: "DMMono_500Medium", fontSize: 28, lineHeight: 34 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

// Apple HIG minimum tap target.
export const MIN_TAP = 44;

export const CONTRAST_PAIRS: Array<[keyof ThemeColors, keyof ThemeColors, number]> = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["textMuted", "background", 4.5],
  ["textMuted", "surface", 4.5],
  ["textMuted", "subtle", 4.5],
  ["onPrimary", "primary", 4.5],
  ["primary", "background", 4.5],
  ["primary", "surface", 4.5],
  ["onDestructive", "destructive", 4.5],
  ["destructive", "surface", 4.5],
  ["warning", "surface", 4.5],
  ["success", "surface", 4.5],
  ["info", "surface", 4.5],
  ["focus", "surface", 3],
];
