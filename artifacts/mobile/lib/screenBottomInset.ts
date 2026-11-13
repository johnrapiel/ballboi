// One bottom inset for every scrolling screen (Wave 2 finding 39, decision 194).
// Pure math so it can be tested in Node; hooks/useScreenBottomInset.ts reads
// the real tab bar, safe area and pinned button heights and passes them in.
//
// Whatever sits over the bottom of the screen (the tab bar, a pinned button,
// or just the home indicator), the last content scrolls clear of it with one
// standard gap: `space-6`, the design system's space between cards.

import { spacing } from "@/constants/tokens";
import { BUTTON_HEIGHT } from "@/lib/buttonSize";

/** The space between the last content and whatever covers the bottom. */
export const SCREEN_GAP = spacing.space6;

/**
 * UIKit's tab bar height above the home indicator. Only a floor for the
 * iOS 26 system tab bar, whose real height normally arrives in the screen's
 * safe area; it never makes the inset smaller than the measured one.
 */
export const UIKIT_TAB_BAR_HEIGHT = 49;

/**
 * A pinned button bar before it has measured itself: `space-3` above and
 * below a 48pt button, plus its hairline. The real height replaces it on the
 * first layout.
 */
export const PINNED_BAR_ESTIMATE = spacing.space3 + BUTTON_HEIGHT + spacing.space3 + 1;

export type BottomEdge =
  /**
   * A tab. `measured` is the JS tab bar's own measured height (it includes
   * the home indicator and grows with its labels); it's undefined with the
   * iOS 26 system tab bar, whose height shows up in `safeBottom` instead.
   */
  | { kind: "tabBar"; measured: number | undefined; safeBottom: number; windowSafeBottom: number }
  /** A button bar pinned to the bottom; `height` is its measured height, home indicator included. 0 until measured. */
  | { kind: "pinned"; height: number; safeBottom: number }
  /**
   * A button bar laid out below the scroll view (not over it): the scroll
   * view already ends at the bar's top edge, so only the gap is left.
   */
  | { kind: "barBelow" }
  /** Nothing over the content but the home indicator. */
  | { kind: "none"; safeBottom: number };

export interface BottomInset {
  /** For `contentContainerStyle.paddingBottom`. */
  paddingBottom: number;
  /** For `scrollIndicatorInsets.bottom`: the scroll bar stops where the covering bar starts. */
  indicatorBottom: number;
}

function n(v: number | undefined): number {
  return v != null && Number.isFinite(v) && v > 0 ? v : 0;
}

/** How much of the screen's bottom is covered, before the gap. */
export function coveredBottom(edge: BottomEdge): number {
  switch (edge.kind) {
    case "tabBar": {
      const measured = n(edge.measured);
      if (measured > 0) return measured;
      // The system tab bar: the screen's safe area already reaches its top
      // edge. If it ever reports only the home indicator, the UIKit height
      // keeps the last card clear anyway.
      return Math.max(n(edge.safeBottom), n(edge.windowSafeBottom) + UIKIT_TAB_BAR_HEIGHT);
    }
    case "pinned": {
      const h = n(edge.height);
      return h > 0 ? h : n(edge.safeBottom) + PINNED_BAR_ESTIMATE;
    }
    case "barBelow":
      return 0;
    case "none":
      return n(edge.safeBottom);
  }
}

export function screenBottomInset(edge: BottomEdge): BottomInset {
  const covered = coveredBottom(edge);
  return { paddingBottom: covered + SCREEN_GAP, indicatorBottom: covered };
}
