import React from "react";
import { Linking, Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useNotificationAccess } from "@/hooks/useNotificationAccess";
import { showOffLine } from "@/lib/notificationAccess";

export const NOTIFICATIONS_OFF_TEXT = "Notifications are off, so messages and match reminders can't reach you.";

/**
 * One line on Home when Ball Boi's notifications are off (decision 125). It
 * opens Ball Boi in iOS Settings. Ball Boi never asks again, and the line
 * goes away once notifications are back on.
 */
export function NotificationsOffBanner() {
  const c = useColors();
  const access = useNotificationAccess();
  if (!showOffLine(access)) return null;
  return (
    <Pressable
      onPress={() => void Linking.openSettings()}
      accessibilityRole="button"
      accessibilityLabel={`${NOTIFICATIONS_OFF_TEXT} Turn on in Settings`}
      accessibilityHint="Opens Ball Boi in iOS Settings"
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        backgroundColor: c.sand,
        borderRadius: radius.radiusMd,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="bell" size={20} tintColor={c.ink} />
      <View style={{ flex: 1 }}>
        <Text variant="small">
          {`${NOTIFICATIONS_OFF_TEXT} `}
          <Text variant="small" style={{ textDecorationLine: "underline" }}>
            Turn on in Settings
          </Text>
        </Text>
      </View>
    </Pressable>
  );
}
