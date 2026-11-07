import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { RatingBadge } from "@/components/RatingBadge";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { rowDetail, type DiscoverPlayerRow } from "@/lib/discover";
import { photoUrl } from "@/lib/photos";

/**
 * One player in Players near you (canvas W2_Discover): photo or initials,
 * name and level, "~4 mi · Singles", then "Played 14 · 1 no-show" or "New to
 * Ball Boi". No free times on the row (F14). One VoiceOver element: "Sam
 * Whitfield, level 3.5, about 4 miles away, singles, played 14, 1 no-show".
 */
export function PlayerRow({ player, onPress, last }: { player: DiscoverPlayerRow; onPress: () => void; last?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={player.spoken}
      accessibilityHint="Opens their player card"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        minHeight: 72,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={player.name} uri={photoUrl(player.avatarUrl)} size={44} />
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
            {player.name}
          </Text>
          {player.rating != null ? (
            <RatingBadge rating={player.rating} source={player.ratingSource === "verified" ? "verified" : "self"} />
          ) : null}
        </View>
        <Text variant="small" tone="inkMuted">
          {rowDetail(player)}
        </Text>
        <Text variant="small" tone="inkMuted">
          {player.reliability}
        </Text>
      </View>
      <View style={{ paddingTop: spacing.space3 }}>
        <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
      </View>
    </Pressable>
  );
}
