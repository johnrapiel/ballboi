import { SymbolView } from "expo-symbols";
import React from "react";
import { Linking, Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useNotificationAccess } from "@/hooks/useNotificationAccess";
import { showOffBanner } from "@/lib/notificationAccess";

/**
 * One line on Home when the player turned Ball Boi's notifications off (spec:
 * Permissions, decision 11): it opens iOS Settings. Ball Boi never asks again,
 * and the line goes away once notifications are back on.
 */
export function NotificationsOffBanner() {
  const c = useColors();
  const access = useNotificationAccess();
  if (!access || !showOffBanner(access)) return null;
  return (
    <Pressable
      onPress={() => void Linking.openSettings()}
      accessibilityRole="button"
      accessibilityLabel="Notifications are off, so match day reminders can't reach you. Turn on in Settings"
      accessibilityHint="Opens Ball Boi in iOS Settings"
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        borderRadius: radius.radiusMd,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <SymbolView name="bell.slash" tintColor={c.ink} size={18} />
      <View style={{ flex: 1 }}>
        <Text variant="small">
          Notifications are off, so match day reminders can't reach you.{" "}
          <Text variant="small" style={{ textDecorationLine: "underline" }}>
            Turn on in Settings
          </Text>
        </Text>
      </View>
    </Pressable>
  );
}
