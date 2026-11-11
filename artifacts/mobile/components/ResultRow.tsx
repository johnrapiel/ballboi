import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import { ResultTag, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { resultRowText, type ResultRowData } from "@/lib/resultRow";

export type { ResultRowData } from "@/lib/resultRow";

// A result on Profile's Results and Career's seasons: W in green or L in red with the letter,
// never color alone (John, Nov 6), then the score from your side and who it
// was against. A double default has no winner, so no tag; its score reads
// "Double default". The whole row is one VoiceOver button that opens Match detail.

/** With no onPress, the row is plain text with no chevron. Every result opens Match detail today (decision 151). */
export function ResultRow({ r, last, onPress }: { r: ResultRowData; last: boolean; onPress?: () => void }) {
  const c = useColors();
  // D8: a doubles result reads "You and Sam vs. Jo and Lee"; VoiceOver hears the names in full.
  const { sub, label } = resultRowText(r);
  const row = {
    minHeight: 56,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.space3,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space3,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: c.hairline,
  };
  const body = (
    <>
      {/* No winner: a hidden tag keeps the scores lined up at every text size. */}
      {r.won == null ? (
        <ResultTag won={false} style={{ opacity: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : (
        <ResultTag won={r.won} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
          {r.score}
        </Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      {onPress ? <Icon name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={row}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the match"
      style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}
