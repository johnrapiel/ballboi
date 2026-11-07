import React from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Card, Pill, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { needLabel, type OpenMatchCard as Card_ } from "@/lib/discover";

/**
 * An open match in Discover (canvas W2_DiscoverMatches): "Sat, Nov 14 · 9 to
 * 11 AM" with "Your post" / "You're in" and "Need 2" (doubles only, F6), then
 * "Doubles · Level 3.0 to 4.0" and "Beacon Courts · ~3 mi · Dana". One
 * VoiceOver button.
 */
export function OpenMatchCard({ match, onPress }: { match: Card_; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={match.spoken} accessibilityHint="Opens the match">
      {({ pressed }) => (
        <Card style={{ gap: spacing.space2, paddingRight: spacing.space8, opacity: pressed ? 0.75 : 1 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
            <Icon name="calendar" size={16} tintColor={c.ink} />
            <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
              {match.when}
            </Text>
            {match.tags.includes("your_post") ? <Pill label="Your post" /> : null}
            {match.tags.includes("youre_in") ? <Pill label="You're in" /> : null}
            {match.need ? <Pill label={needLabel(match.need)} /> : null}
          </View>
          <Text variant="small">{match.detail}</Text>
          <Text variant="small" tone="inkMuted">
            {match.where}
          </Text>
          <View style={{ position: "absolute", right: spacing.space4, top: spacing.space4 }} pointerEvents="none">
            <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
          </View>
        </Card>
      )}
    </Pressable>
  );
}
