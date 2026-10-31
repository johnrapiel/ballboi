import { SymbolView } from "expo-symbols";
import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatRating, type RatingSource } from "@/lib/onboarding";

/**
 * Ball Boi Rating with its source (spec: Ball Boi Rating; checklist 5, rating
 * badges not color-only). Verified and Self-rated differ by icon and word, never
 * by color: both are ink. VoiceOver reads it as one element, "3.5, Self-rated".
 */
export function RatingBadge({ rating, source }: { rating: number; source: RatingSource }) {
  const c = useColors();
  const verified = source === "verified";
  const word = verified ? "Verified" : "Self-rated";
  const value = formatRating(rating);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Ball Boi Rating ${value}, ${word}`}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: spacing.space2,
        paddingHorizontal: spacing.space3,
        paddingVertical: spacing.space1,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        backgroundColor: c.linen,
      }}
    >
      <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
        <SymbolView
          name={verified ? "checkmark.seal" : "person"}
          size={14}
          tintColor={c.ink}
          type="monochrome"
        />
        <Text variant="small">{word}</Text>
      </View>
    </View>
  );
}
