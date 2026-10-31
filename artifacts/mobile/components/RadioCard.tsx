import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * One answer in a list of cards where you pick one. Put a set of these inside a
 * View with accessibilityRole="radiogroup". Selected shows a filled check and a
 * heavier ink border, so the choice never relies on color alone.
 */
export function RadioCard({
  title,
  description,
  meta,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  /** Short text at the top right, like a rating. Also read by VoiceOver. */
  meta?: { text: string; spoken: string };
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[title, description, meta?.spoken].filter(Boolean).join(". ")}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.space3,
        padding: spacing.space4,
        borderRadius: radius.radiusMd,
        // 2px ink when selected, the 3:1 control border otherwise; plus the check icon.
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.ink : c.hairlineStrong,
        // Keeps the text from shifting when the border thickens.
        margin: selected ? 0 : 1,
        backgroundColor: c.linen,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <SymbolView name={selected ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.ink} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.space2 }}>
          <Text variant="bodyStrong">{title}</Text>
          {meta ? (
            <Text variant="small" tone="inkMuted" style={{ fontVariant: ["tabular-nums"] }}>
              {meta.text}
            </Text>
          ) : null}
        </View>
        <Text variant="small" tone="inkMuted">
          {description}
        </Text>
      </View>
    </Pressable>
  );
}
