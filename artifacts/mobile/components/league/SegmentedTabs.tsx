import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// The condensed native look from the approved canvas (John, Nov 5): a sand
// track with 2pt padding, 32pt segments, and a linen selected segment with a
// soft shadow. Each segment is still a 44pt target through hitSlop, so the
// control looks iOS-sized without shrinking what a thumb can hit.
const SEGMENT = 32;
const SLOP = (MIN_TAP - SEGMENT) / 2;

/**
 * Tabs within one screen, styled like an iOS segmented control. The selected
 * tab sits on linen in ink; the others are muted. VoiceOver reads it as a
 * selected tab (or a checked radio button for a form choice), so the colour
 * is never the only signal.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  choice = false,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** What the tabs switch between, for VoiceOver. */
  label: string;
  /** A form choice (Format, Playoffs) rather than tabs: VoiceOver reads radio buttons. */
  choice?: boolean;
}) {
  const c = useColors();
  return (
    <View
      accessibilityRole={choice ? "radiogroup" : "tablist"}
      accessibilityLabel={label}
      style={{ flexDirection: "row", padding: 2, borderRadius: 9, backgroundColor: c.sand }}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole={choice ? "radio" : "tab"}
            accessibilityState={choice ? { checked: on } : { selected: on }}
            accessibilityLabel={t.label}
            hitSlop={{ top: SLOP, bottom: SLOP }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: SEGMENT,
              paddingHorizontal: 6,
              paddingVertical: 4,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: on ? c.linen : "transparent",
              // A soft ink shadow lifts the chosen segment by day. At night an
              // ivory shadow would glow, so the linen fill on sand does it alone.
              shadowColor: c.ink,
              shadowOpacity: on && c.scheme === "light" ? 0.16 : 0,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 1 },
              elevation: on ? 1 : 0,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="segment" tone={on ? "ink" : "inkMuted"} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
