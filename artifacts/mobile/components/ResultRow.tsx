import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import type { LeagueWeekResult } from "@workspace/api-client-react";

import { ResultTag, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { LATE_RESULT } from "@/lib/leagueSchedule";

// A result on Profile's Results and Career's seasons: W in green or L in red with the letter,
// never color alone (John, Nov 6), then the score from your side and who it
// was against. The whole row is one VoiceOver button that opens Match detail.

/** What a row needs: your results from the league week, or a career result. */
export type ResultRowData = Pick<LeagueWeekResult, "won" | "score" | "opponentName" | "leagueName" | "playoff" | "inGrace">;

/** With no onPress, the row is plain text with no chevron. Every result opens Match detail today (decision 151). */
export function ResultRow({ r, last, onPress }: { r: ResultRowData; last: boolean; onPress?: () => void }) {
  const c = useColors();
  const outcome = r.won ? "Won" : "Lost";
  const sub = [`vs. ${r.opponentName}`, r.leagueName, r.playoff ? "Playoffs" : null, r.inGrace ? LATE_RESULT : null]
    .filter(Boolean)
    .join(" · ");
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
      <ResultTag won={r.won} />
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
  const label = `${outcome} ${r.score}. ${sub}`;
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
