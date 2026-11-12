import React from "react";
import { ActivityIndicator, Pressable } from "react-native";

import { Icon } from "@/components/Icon";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * Leaving (a league, today): a quiet danger-colored text action with a door
 * icon at the bottom of the page, like Cancel account on many sites. The tap
 * opens a confirm alert; this never acts on its own (decision 184, John, Nov 12).
 * The door carries the meaning too, so color is never the only signal.
 * `danger` on `paper` clears 4.5:1 in Day, Night and Increase Contrast
 * (scripts/check-contrast.mjs).
 */
export function LeaveAction({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      hitSlop={spacing.space2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        paddingHorizontal: spacing.space2,
        marginTop: spacing.space6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={c.danger} />
      ) : (
        <Icon name="door.leave" size={20} tintColor={c.danger} />
      )}
      <Text tone="danger" style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
