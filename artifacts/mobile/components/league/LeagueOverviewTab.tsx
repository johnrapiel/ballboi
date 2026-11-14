import React from "react";
import { View, useWindowDimensions } from "react-native";

import { LeaveAction } from "@/components/LeaveAction";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isAccessibilityTextSize, type AboutRow } from "@/lib/leaguePage";

// The league page's Overview tab (Wave 3, decision 210; L5, Nov 14): About
// this league only (format, matches, where, season, players), then Leave
// league as quiet red text with the door icon (decision 184). At the
// accessibility text sizes each value drops under its label, left-aligned,
// instead of squeezing into a narrow right-hand column.

function Row({ row, last, stacked }: { row: AboutRow; last: boolean; stacked: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${row.label}, ${row.value}`}
      style={{
        flexDirection: stacked ? "column" : "row",
        justifyContent: "space-between",
        gap: stacked ? 2 : spacing.space4,
        padding: spacing.space4,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text tone="inkMuted">{row.label}</Text>
      <Text style={stacked ? undefined : { flexShrink: 1, textAlign: "right" }}>{row.value}</Text>
    </View>
  );
}

export function LeagueOverviewTab({
  rows,
  canLeave,
  leaving,
  offline,
  onLeave,
}: {
  rows: AboutRow[];
  /** You play in it and it hasn't ended. */
  canLeave: boolean;
  leaving: boolean;
  /** Offline: leaving needs the server, so it's off (L8). */
  offline: boolean;
  onLeave: () => void;
}) {
  const stacked = isAccessibilityTextSize(useWindowDimensions().fontScale);
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header">
        About this league
      </Text>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <Row key={r.label} row={r} last={i === rows.length - 1} stacked={stacked} />
        ))}
      </Card>
      {canLeave ? <LeaveAction label="Leave league" busy={leaving} disabled={offline} onPress={onLeave} /> : null}
    </View>
  );
}
