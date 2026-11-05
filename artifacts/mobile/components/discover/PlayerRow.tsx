import type { DiscoverPlayerCard } from "@workspace/api-client-react";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { playerLine, playerSpoken } from "@/lib/discover";
import { photoUrl } from "@/lib/photos";

/**
 * One player in Players near you (canvas: Discover): photo or initials, name,
 * and "3.5 · ~2 mi away · Played 12". Opens their Discover profile.
 */
export function PlayerRow({ player, onPress }: { player: DiscoverPlayerCard; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playerSpoken(player)}
      accessibilityHint="Opens their profile"
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={player.name} uri={photoUrl(player.avatarUrl)} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{player.name}</Text>
        <Text variant="small" tone="inkMuted" style={{ fontVariant: ["tabular-nums"] }}>
          {playerLine(player)}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={14} tintColor={c.inkMuted} />
    </Pressable>
  );
}
