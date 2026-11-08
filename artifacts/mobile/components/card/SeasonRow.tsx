import React from "react";
import { useWindowDimensions, View } from "react-native";

import type { PlayerCardSeason } from "@workspace/api-client-react";

import { SectionHead } from "@/components/SectionHead";
import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { seasonCells, seasonSpoken } from "@/lib/playerCard";

// This season under the player card (decision 139; canvas W2_ProfileCard):
// Record, Played, Streak and No-shows in one row, split by hairlines, read
// by VoiceOver as one group. Played and No-shows follow F13 (decision 121).
// The streak is a letter and a number, never a color. At the largest text
// sizes it wraps to two by two so nothing truncates.

export function SeasonRow({ season }: { season: PlayerCardSeason }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const twoUp = fontScale >= 1.3;
  const cells = seasonCells(season);
  return (
    <View style={{ gap: spacing.space2 }}>
      <SectionHead title="This season" />
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={seasonSpoken(season)}
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
              flexBasis: twoUp ? "50%" : "25%",
              alignItems: "center",
              gap: 2,
              paddingHorizontal: spacing.space1,
              borderLeftWidth: (twoUp ? i % 2 === 0 : i === 0) ? 0 : 1,
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
    </View>
  );
}
