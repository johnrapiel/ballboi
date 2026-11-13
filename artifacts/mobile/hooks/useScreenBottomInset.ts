import { BottomTabBarHeightContext } from "expo-router/tabs";
import { useCallback, useContext, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";

import { screenBottomInset, type BottomEdge } from "@/lib/screenBottomInset";

/**
 * The one bottom inset for every scrolling screen (decision 194): the last
 * content scrolls clear of the tab bar, a pinned button or the home
 * indicator, with one standard gap (`space-6`). Spread the result into the
 * scroll view:
 *
 *   const bottom = useScreenBottomInset({ tab: true });
 *   <ScrollView
 *     contentContainerStyle={{ ..., paddingBottom: bottom.paddingBottom }}
 *     scrollIndicatorInsets={bottom.scrollIndicatorInsets}
 *   />
 *
 * - `tab: true` on the five tabs. Before iOS 26 the tab bar is the JS one and
 *   its real, measured height (it grows with larger text) comes from the
 *   navigator. On iOS 26 the system tab bar's height is in the tab's safe
 *   area, since every tab sets `disableAutomaticContentInsets` and leaves the
 *   insets to this hook.
 * - `pinnedHeight` on screens whose pinned button floats over the content:
 *   the bar's measured height from `usePinnedBarHeight`.
 * - `barBelow: true` when the pinned button is laid out below the scroll
 *   view (Send Round N to players, Create league): the scroll view already
 *   stops at the bar, so the content just keeps the gap above it.
 * - Neither: the home indicator plus the gap.
 */
export function useScreenBottomInset(options: { tab?: boolean; pinnedHeight?: number; barBelow?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  const edge: BottomEdge = options.tab
    ? {
        kind: "tabBar",
        measured: tabBarHeight,
        safeBottom: insets.bottom,
        windowSafeBottom: initialWindowMetrics?.insets.bottom ?? 0,
      }
    : options.barBelow
      ? { kind: "barBelow" }
      : options.pinnedHeight !== undefined
        ? { kind: "pinned", height: options.pinnedHeight, safeBottom: insets.bottom }
        : { kind: "none", safeBottom: insets.bottom };
  const inset = screenBottomInset(edge);
  return { paddingBottom: inset.paddingBottom, scrollIndicatorInsets: { bottom: inset.indicatorBottom } };
}

/**
 * Measures a bar pinned to the bottom of the screen, so the content above it
 * can scroll clear of it at any text size. Put `onLayout` on the bar and pass
 * `height` to `useScreenBottomInset({ pinnedHeight })`.
 */
export function usePinnedBarHeight() {
  const [height, setHeight] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setHeight((prev) => (prev === h ? prev : h));
  }, []);
  return { height, onLayout };
}
