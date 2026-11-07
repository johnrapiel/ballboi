import React from "react";
import { useWindowDimensions, View } from "react-native";

import type { LeagueWeekSeason } from "@workspace/api-client-react";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { recordLabel, seasonSpoken, streakLabel, winRateLabel } from "@/lib/myMatches";

// Your season on one line (finding 14; approved design audit, Home and My
// matches): Record, Win rate and Streak, plus Played on My matches, split by
// hairlines on a white panel. Records and rates in serif tabular figures.
// Streak is words, never a color. VoiceOver reads the line as one summary.
// At the largest text sizes it wraps to two columns so nothing truncates.

export function SeasonStats({ season, played = false }: { season: LeagueWeekSeason; played?: boolean }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const items = [
    { k: "Record", v: recordLabel(season) },
    { k: "Win rate", v: winRateLabel(season) },
    { k: "Streak", v: streakLabel(season) },
    ...(played ? [{ k: "Played", v: String(season.played) }] : []),
  ];
  const twoUp = fontScale >= 1.3;
  return (
    <View
      accessible
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
      {items.map((it, i) => {
        const firstInRow = twoUp ? i % 2 === 0 : i === 0;
        return (
          <View
            key={it.k}
            style={{
              flexBasis: twoUp ? "50%" : `${100 / items.length}%`,
              paddingHorizontal: spacing.space3,
              borderLeftWidth: firstInRow ? 0 : 1,
              borderLeftColor: c.hairline,
              gap: 2,
            }}
          >
            <Text variant="small" tone="inkMuted" numberOfLines={1}>
              {it.k}
            </Text>
            <Text variant="title" style={{ fontVariant: ["lining-nums", "tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>
              {it.v}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
