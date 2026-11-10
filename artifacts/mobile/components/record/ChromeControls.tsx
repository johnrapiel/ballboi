// Controls for the dark camera screen, styled with the Night palette in
// lib/recording/chrome.ts. Same sizes and roles as the shared components.

import React from "react";
import { Pressable, View } from "react-native";

import { Text, useButtonHeight } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { BUTTON_PAD_X } from "@/lib/buttonSize";
import { chrome } from "@/lib/recording/chrome";

export function ChromeButton({
  label,
  onPress,
  variant = "primary",
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Off: dimmed, and VoiceOver says "dimmed". */
  disabled?: boolean;
}) {
  const primary = variant === "primary";
  // The one button height (John, Nov 10), same as every Button.
  const height = useButtonHeight();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height,
        minWidth: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: primary ? chrome.button : chrome.scrim,
        borderWidth: primary ? 0 : 1,
        borderColor: chrome.border,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: BUTTON_PAD_X,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        variant="button"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ color: primary ? chrome.onButton : chrome.text, textAlign: "center" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Pick one option, like a segmented control. Selected is filled, with no icon (John, Nov 7); VoiceOver reads "selected". */
export function ChromeChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: spacing.space2, alignItems: "center" }}>
      <Text variant="section" style={{ color: chrome.text }} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <View
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.space2 }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label}, ${o.label}`}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => ({
                minHeight: MIN_TAP,
                minWidth: MIN_TAP,
                paddingHorizontal: spacing.space4,
                borderRadius: radius.radiusPill,
                borderWidth: 1,
                borderColor: on ? chrome.button : chrome.border,
                backgroundColor: on ? chrome.button : chrome.scrim,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.space1,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text variant="bodyStrong" style={{ color: on ? chrome.onButton : chrome.text }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A quiet underlined link on the camera, like "Setup tips". 44pt target. */
export function ChromeLink({
  label,
  onPress,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={spacing.space1}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space2,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant="bodyStrong" style={{ color: chrome.text, textDecorationLine: "underline", textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}
