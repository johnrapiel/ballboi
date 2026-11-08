// Colors for the camera screen. The camera is always dark, like the iOS Camera
// app, so it uses the Night session tokens whatever the phone's appearance.
// Every text pair here is a Night pair already checked by check-contrast.mjs.

import { color } from "@/constants/tokens";

const night = color.dark;

export const chrome = {
  /** Camera letterbox and the area behind the preview. */
  ground: "#000000",
  /** Panels and controls laid over live video: Night paper, nearly opaque. */
  scrim: "rgba(31, 30, 29, 0.88)", // Night paper (#1F1E1D) at 88%
  panel: night.linen,
  text: night.ink,
  textMuted: night.inkMuted,
  border: night.hairlineStrong,
  danger: night.danger,
  /** Fill for the main button: light ink on the dark camera, text in Night paper. */
  button: night.ink,
  onButton: night.paper,
  /**
   * The Rec pill: the one place clay stays (design system README, Nov 6
   * exception). White on #943F24 is 7.0:1. Always with the word "Rec".
   */
  rec: "#943F24",
  onRec: "#FFFFFF",
} as const;
