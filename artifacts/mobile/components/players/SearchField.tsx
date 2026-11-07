import { SymbolView } from "expo-symbols";
import React from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";

import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useTypeStyle } from "@/components/ui";

/**
 * The player search bar (findings #15 and #18): an iOS style search field
 * with a magnifying glass, a 44pt Clear button once there's text, and a
 * spinner while results load. VoiceOver reads it as a search field.
 */
export function SearchField({
  value,
  onChangeText,
  label = "Search players",
  placeholder = "Search by name",
  busy = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** What VoiceOver reads for the field. */
  label?: string;
  placeholder?: string;
  busy?: boolean;
}) {
  const c = useColors();
  const body = useTypeStyle("body");
  return (
    <View
      style={{
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        paddingLeft: spacing.space3,
        borderRadius: radius.radiusSm,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        backgroundColor: c.linen,
      }}
    >
      <SymbolView name="magnifyingglass" size={18} tintColor={c.inkMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityRole="search"
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={c.inkMuted}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="search"
        enablesReturnKeyAutomatically
        maxLength={60}
        maxFontSizeMultiplier={body.maxFontSizeMultiplier}
        style={[body.style, { flex: 1, minHeight: MIN_TAP, paddingVertical: spacing.space2, color: c.ink }]}
      />
      {busy ? <ActivityIndicator color={c.ink} accessibilityLabel="Searching" /> : null}
      {value ? (
        <Pressable
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={({ pressed }) => ({
            width: MIN_TAP,
            height: MIN_TAP,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColor={c.inkMuted} />
        </Pressable>
      ) : (
        <View style={{ width: spacing.space2 }} />
      )}
    </View>
  );
}
