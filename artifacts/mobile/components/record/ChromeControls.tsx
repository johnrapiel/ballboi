// Controls for the dark camera screen, styled with the Night palette in
// lib/recording/chrome.ts. Same sizes and roles as the shared components.

import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { chrome } from "@/lib/recording/chrome";

export function ChromeButton({
  label,
  onPress,
  variant = "primary",
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  accessibilityLabel?: string;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: primary ? chrome.button : chrome.scrim,
        borderWidth: primary ? 0 : 1,
        borderColor: chrome.border,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.space6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="button" style={{ color: primary ? chrome.onButton : chrome.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Pick one option, like a segmented control. Selected is filled and checked. */
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
      <Text variant="label" style={{ color: chrome.text }} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.space2 }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${label} ${o.label}`}
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
              {on ? <SymbolView name="checkmark" size={12} tintColor={chrome.onButton} /> : null}
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
