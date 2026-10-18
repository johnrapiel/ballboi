import { color, radius, type ColorTokens } from "@/constants/tokens";

// Maps the app's palette keys onto the Ball Boi design system tokens
// (constants/tokens.ts, generated from docs/design-system/tokens.json).
// New code should read design system names directly via useColors():
// paper, linen, sand, ink, inkMuted, onInk, hairline, hairlineStrong,
// pool, clay, sun (never text), danger, focus.

function palette(t: ColorTokens) {
  return {
    ...t,
    // Legacy keys used by screens that haven't been rebuilt yet.
    text: t.ink,
    tint: t.pool,
    background: t.paper,
    foreground: t.ink,
    card: t.linen,
    cardForeground: t.ink,
    primary: t.ink,
    primaryForeground: t.onInk,
    secondary: t.pool,
    secondaryForeground: t.onInk,
    muted: t.sand,
    mutedForeground: t.inkMuted,
    accent: t.sand,
    accentForeground: t.ink,
    destructive: t.danger,
    destructiveForeground: t.onInk,
    border: t.hairline,
    input: t.hairlineStrong,
  };
}

const colors = {
  light: palette(color.light),
  dark: palette(color.dark),
  radius: radius.radiusMd,
};

export default colors;
