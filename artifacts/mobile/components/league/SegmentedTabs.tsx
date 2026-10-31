import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * Tabs within one screen, styled like an iOS segmented control. The selected
 * tab is ink-filled with a bold label, and VoiceOver reads it as a selected tab.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** What the tabs switch between, for VoiceOver. */
  label: string;
}) {
  const c = useColors();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 3,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
      }}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: MIN_TAP - 6,
              paddingHorizontal: spacing.space2,
              borderRadius: radius.radiusPill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: on ? c.ink : "transparent",
              opacity: pressed ? 0.8 : 1,
            })}
            hitSlop={{ top: 3, bottom: 3 }}
          >
            <Text variant={on ? "bodyStrong" : "body"} tone={on ? "onInk" : "ink"} numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
