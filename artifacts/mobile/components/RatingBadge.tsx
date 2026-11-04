import { SymbolView } from "expo-symbols";
import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatRating, levelSourceWord, levelSpoken, type RatingSource } from "@/lib/onboarding";

/**
 * A player's level with its source (spec: Ball Boi Rating; checklist 5, badges
 * not color-only; Wave 1 review S9). Reads "Level 3.5, Self-rated". The source
 * word comes from `source`, so a verified source (a future USTA or NTRP link)
 * replaces "Self-rated" with its own word and icon. Sources differ by icon and
 * word, never by color: both are ink. VoiceOver reads it as one element,
 * "Level 3.5, self-rated".
 */
export function RatingBadge({ rating, source }: { rating: number; source: RatingSource }) {
  const c = useColors();
  const verified = source === "verified";
  const word = levelSourceWord(source);
  const value = formatRating(rating);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={levelSpoken(rating, source)}
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
        {`Level ${value},`}
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
