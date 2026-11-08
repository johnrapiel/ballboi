import React from "react";
import { useWindowDimensions, View } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// A row of stat cells split by hairlines on a linen card, read by VoiceOver
// as one group (canvas W2_ProfileCard's This season). Used by This season
// (four across) and Career (three across, two rows). At the largest text
// sizes it wraps to two across so nothing truncates. Values are words and
// numbers, never color.

export function StatGrid({ cells, spoken, columns }: { cells: { label: string; value: string }[]; spoken: string; columns: 3 | 4 }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const across = fontScale >= 1.3 ? 2 : columns;
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={spoken}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        rowGap: spacing.space3,
        backgroundColor: c.linen,
        borderColor: c.hairline,
        borderWidth: 1,
        borderRadius: radius.radiusCard,
        paddingVertical: spacing.space3,
      }}
    >
      {cells.map((cell, i) => (
        <View
          key={cell.label}
          style={{
            flexBasis: `${100 / across}%`,
            alignItems: "center",
            gap: 2,
            paddingHorizontal: spacing.space1,
            borderLeftWidth: i % across === 0 ? 0 : 1,
            borderLeftColor: c.hairline,
          }}
        >
          <Text variant="small" tone="inkMuted" numberOfLines={1}>
            {cell.label}
          </Text>
          <Text variant="title" numberOfLines={1} adjustsFontSizeToFit style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
            {cell.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
