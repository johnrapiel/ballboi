import type { OpenLeagueCard } from "@workspace/api-client-react";
import React from "react";
import { Pressable, View } from "react-native";

import { Chip, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { leagueLine, leagueTag, localDay } from "@/lib/discover";

/**
 * One Open league in Discover (canvas: Discover, Open leagues): name, spots
 * left or where you stand, then distance, format, level range and start date.
 * Opens the league's preview.
 */
export function LeagueCard({ league, onPress }: { league: OpenLeagueCard; onPress: () => void }) {
  const c = useColors();
  const line = leagueLine(league, localDay());
  const tag = leagueTag(league);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${league.name}, ${tag}. ${line.replace(/ · /g, ", ").replace(/^~/, "about ")}`}
      accessibilityHint="Opens the league"
      style={({ pressed }) => ({
        marginHorizontal: spacing.space4,
        padding: spacing.space4,
        gap: spacing.space2,
        borderRadius: radius.radiusLg,
        borderWidth: 1,
        borderColor: c.hairline,
        backgroundColor: c.linen,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.space3, flexWrap: "wrap" }}>
        <Text variant="bodyStrong" style={{ flex: 1, minWidth: 160 }}>
          {league.name}
        </Text>
        <Chip label={tag} />
      </View>
      <Text variant="small" tone="inkMuted">
        {line}
      </Text>
    </Pressable>
  );
}
