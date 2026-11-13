import React from "react";
import { ActivityIndicator, Pressable } from "react-native";

import { Icon, type IconName } from "@/components/Icon";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * A quiet destructive action: danger-colored text with a brush icon at the
 * bottom of the page content (not pinned), like Cancel account on many sites.
 * Used for Leave league, Cancel match and Drop out (decision 184, John, Nov 12).
 * The tap opens a native destructive alert; this never acts on its own
 * (decision 193). The icon carries the meaning too, so color is never the only
 * signal. Its 44pt target is minHeight plus hitSlop (decision 192). `danger` on
 * `paper` clears 4.5:1 in Day, Night and Increase Contrast
 * (scripts/check-contrast.mjs).
 */
export function DangerLink({
  label,
  icon,
  onPress,
  busy = false,
  disabled = false,
  accessibilityHint,
  inline = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  /** Beside other controls (Remove photo under Change photo): no top gap, left-aligned. */
  inline?: boolean;
}) {
  const c = useColors();
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      hitSlop={spacing.space2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        alignSelf: inline ? "flex-start" : "center",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        paddingHorizontal: spacing.space2,
        marginTop: inline ? 0 : spacing.space6,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={c.danger} /> : <Icon name={icon} size={20} tintColor={c.danger} />}
      <Text tone="danger" style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
