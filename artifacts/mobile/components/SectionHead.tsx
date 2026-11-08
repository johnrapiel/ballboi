import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";

// A section label in sentence case, with an optional "See all" link beside it.

export function SectionHead({ title, onSeeAll, seeAllLabel }: { title: string; onSeeAll?: () => void; seeAllLabel?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3, marginTop: spacing.space2, paddingHorizontal: spacing.space1 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {onSeeAll ? <SeeAll onPress={onSeeAll} accessibilityLabel={seeAllLabel ?? "See all"} /> : null}
    </View>
  );
}

/** The "See all" text button beside a section label: 44pt, underlined so it reads as a link. */
export function SeeAll({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={spacing.space1}
      style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", alignItems: "flex-end", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ textDecorationLine: "underline" }}>See all</Text>
    </Pressable>
  );
}
