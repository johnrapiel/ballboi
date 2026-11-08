// A checkbox with its label, for the record flow (B9, B10, B7). VoiceOver
// reads "I agree to the Ball Boi Beta Footage Release, checkbox, not
// checked". The whole row (box and label) is one 44pt target; a link to read
// more is always a separate target beside it, never inside the label.
// Checked shows a filled box with a check, so state never relies on color.
// `tone="chrome"` is for the dark camera screen (lib/recording/chrome.ts).

import React from "react";
import { Pressable, View } from "react-native";

import { CheckGlyph, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { chrome } from "@/lib/recording/chrome";

export function Checkbox({
  label,
  checked,
  onChange,
  accessibilityHint,
  tone = "app",
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  accessibilityHint?: string;
  tone?: "app" | "chrome";
}) {
  const c = useColors();
  const ink = tone === "chrome" ? chrome.text : c.ink;
  const onInk = tone === "chrome" ? chrome.onButton : c.onInk;
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={spacing.space1}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingVertical: spacing.space2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.radiusSm,
          // The box border is a control border: ink clears 3:1 on every ground.
          borderWidth: 2,
          borderColor: ink,
          backgroundColor: checked ? ink : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <CheckGlyph color={onInk} size={16} /> : null}
      </View>
      <Text variant="bodyStrong" style={{ flex: 1, color: ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
