/**
 * Touch targets that are bigger than what you see get their extra area from
 * `hitSlop`, never from layout height or padding, so a 44pt target doesn't
 * add visible space inside a card (decision 192, Wave 2 finding 38).
 */

import { MIN_TAP, type } from "@/constants/tokens";

export { MIN_TAP };

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Points to add on each side so `size` reaches the 44pt minimum. Never negative. */
export function slopFor(size: number): number {
  if (!Number.isFinite(size) || size < 0) return MIN_TAP / 2;
  return Math.max(0, Math.ceil((MIN_TAP - size) / 2));
}

/**
 * hitSlop for something `height` tall (and `width` wide, when known) that
 * should tap like a 44 × 44pt target. For a text link, pass the text style's
 * line height: larger Dynamic Type only makes the text taller, so the slop
 * from the default size is always enough.
 */
export function tapSlop(height: number, width?: number): Insets {
  const v = slopFor(height);
  const h = width == null ? v : slopFor(width);
  return { top: v, bottom: v, left: h, right: h };
}

/** hitSlop for a one-line text link in a design-system text style. */
export function textTapSlop(variant: keyof typeof type, width?: number): Insets {
  const lineHeight = (type[variant] as { lineHeight?: number }).lineHeight ?? (type[variant] as { fontSize: number }).fontSize;
  return tapSlop(lineHeight, width);
}
