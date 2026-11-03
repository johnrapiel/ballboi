import React from "react";
import { Pressable, View } from "react-native";

import { CheckGlyph, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * One option in a pick-any-number list. VoiceOver reads it as "Run a league,
 * Set up a season and invite players, checkbox, checked". Checked shows a
 * filled box with a check and a heavier ink border, so the state never relies
 * on color alone. The box is drawn (not an SF Symbol) so it matches the
 * design system on every screen.
 */
export function CheckboxCard({
  title,
  description,
  checked,
  onPress,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={[title, description].filter(Boolean).join(". ")}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.space3,
        padding: spacing.space4,
        borderRadius: radius.radiusMd,
        // 2px ink when checked, the 3:1 control border otherwise; plus the box.
        borderWidth: checked ? 2 : 1,
        borderColor: checked ? c.ink : c.hairlineStrong,
        // Keeps the text from shifting when the border thickens.
        margin: checked ? 0 : 1,
        backgroundColor: c.linen,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: radius.radiusSm,
          borderWidth: 2,
          borderColor: c.ink,
          backgroundColor: checked ? c.ink : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <CheckGlyph color={c.onInk} size={14} /> : null}
      </View>
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <Text variant="bodyStrong">{title}</Text>
        {description ? (
          <Text variant="small" tone="inkMuted">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
