import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export interface Segment<T extends string> {
  key: T;
  label: string;
  /** Shown as "(n)" and read as "n waiting". */
  count?: number;
}

/** A tab list for VoiceOver; the selected tab is ink-filled, so it never relies on color alone. */
export function Segmented<T extends string>({ value, onChange, segments }: { value: T; onChange: (v: T) => void; segments: Segment<T>[] }) {
  const c = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        marginHorizontal: spacing.space4,
        marginBottom: spacing.space3,
        padding: 2,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
      }}
    >
      {segments.map((s) => {
        const on = s.key === value;
        const n = s.count ?? 0;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n > 0 ? `${s.label}, ${n} waiting` : s.label}
            style={{
              flex: 1,
              minHeight: MIN_TAP,
              borderRadius: radius.radiusPill,
              backgroundColor: on ? c.ink : "transparent",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing.space2,
            }}
          >
            <Text variant="button" tone={on ? "onInk" : "ink"} numberOfLines={1}>
              {n > 0 ? `${s.label} (${n})` : s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
