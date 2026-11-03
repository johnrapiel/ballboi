import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/** Profile row that opens Blocked players. 44pt minimum, chevron, one VoiceOver element. */
export function BlockedPlayersRow() {
  const c = useColors();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/blocked-players")}
      accessibilityRole="button"
      accessibilityLabel="Blocked players"
      accessibilityHint="Shows players you've blocked, with Unblock"
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        marginBottom: spacing.space3,
        borderRadius: radius.radiusMd,
        borderWidth: 1,
        borderColor: c.hairline,
        backgroundColor: c.linen,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name="hand.raised" size={20} tintColor={c.ink} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">Blocked players</Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}
