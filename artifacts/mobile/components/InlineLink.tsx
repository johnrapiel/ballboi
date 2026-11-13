import React from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { TextLink } from "@/components/ui";
import { textTapSlop } from "@/lib/tapTarget";

// Link text on its own, like "Change time" on Match detail (Wave 2 finding
// 25) and "Match didn't finish?" on Enter score (finding 55): court green and
// underlined (TextLink), with hitSlop for a 44pt target so it adds no space
// around the words (decision 192). VoiceOver reads it as one link.

export function InlineLink({
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  align = "center",
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  /** Spoken in place of the label. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  align?: "center" | "left";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
      hitSlop={textTapSlop("body")}
      style={({ pressed }) => [
        {
          justifyContent: "center",
          alignSelf: align === "center" ? "center" : "flex-start",
          maxWidth: "100%",
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      {/* The words take the same press; the Pressable is the one VoiceOver link. */}
      <TextLink onPress={disabled ? () => undefined : onPress} accessible={false} style={{ textAlign: align === "center" ? "center" : "left" }}>
        {label}
      </TextLink>
    </Pressable>
  );
}
