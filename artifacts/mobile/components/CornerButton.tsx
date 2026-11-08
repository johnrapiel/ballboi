import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon, type IconName } from "@/components/Icon";
import { MIN_TAP, radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/** Liquid Glass can be drawn: iOS 26+ with the API present (some betas lack it). */
function glassAvailable(): boolean {
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

/**
 * The screen-corner button (button standard, John, Nov 8): a 44pt circle with
 * a brush icon in ink. On iOS 26 it's the same Liquid Glass as the tab bar;
 * where Liquid Glass isn't available it's the sand circle with a hairline.
 *
 * Use it for the buttons in the top corners of a tab (Messages, and the tab's
 * own action just left of it). Pushed screens get their corner buttons from
 * the native header (HeaderIconButton), where iOS draws the glass itself.
 *
 * `children` sits on top of the circle, outside the glass, for a badge.
 */
export function CornerButton({
  symbol,
  label,
  hint,
  onPress,
  children,
}: {
  symbol: IconName;
  label: string;
  /** What happens on tap, read by VoiceOver after the label. */
  hint?: string;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const c = useColors();
  const glass = glassAvailable();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {glass ? (
        <GlassView
          glassEffectStyle="regular"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: MIN_TAP / 2, overflow: "hidden" }]}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius.radiusPill, backgroundColor: c.sand, borderWidth: 1, borderColor: c.hairline },
          ]}
        />
      )}
      <Icon name={symbol} size={20} tintColor={c.ink} />
      {children}
    </Pressable>
  );
}
