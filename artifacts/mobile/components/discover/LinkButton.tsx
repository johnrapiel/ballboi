import React from "react";
import { Pressable } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";

/**
 * A link that stands on its own, like See all: court and underlined, as
 * TextLink, with a 44pt target.
 */
export function LinkButton({
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      hitSlop={spacing.space1}
      style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
    >
      <Text tone="court" style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}
