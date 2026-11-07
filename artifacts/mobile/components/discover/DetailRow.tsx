import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * A label and its value in a card row ("Free · Weekday evenings, weekend
 * mornings"). A long value wraps under its label without overlapping it, at
 * every text size (review finding 2). Read as one element: "Free, Weekday
 * evenings, weekend mornings".
 */
export function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        columnGap: spacing.space4,
        rowGap: spacing.space1,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        minHeight: 52,
        alignItems: "center",
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text style={{ flexShrink: 0 }}>{label}</Text>
      <Text tone="inkMuted" style={{ flexShrink: 1, flexGrow: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}
