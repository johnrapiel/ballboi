import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import type { LeagueWeekResult } from "@workspace/api-client-react";

import { ResultTag, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// A result on Home and My matches: W in green or L in red with the letter,
// never color alone (John, Nov 6), then the score from your side and who it
// was against. The whole row is one VoiceOver button that opens Match detail.

export function ResultRow({ r, last, onPress }: { r: LeagueWeekResult; last: boolean; onPress: () => void }) {
  const c = useColors();
  const outcome = r.won ? "Won" : "Lost";
  const sub = [`vs. ${r.opponentName}`, r.leagueName, r.playoff ? "Playoffs" : null, r.inGrace ? "Grace week, not in standings" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${outcome} ${r.score}. ${sub}`}
      accessibilityHint="Opens the match"
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <ResultTag won={r.won} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
          {r.score}
        </Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}
