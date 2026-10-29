import React from "react";
import { View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { matchTime, type RecordableMatch } from "@/lib/recording/api";

/** "Tuesday Flex · 6:00 PM · Memorial Park" (whichever parts exist). */
export function matchMeta(m: RecordableMatch): string {
  return [m.leagueName ?? "Quick match", matchTime(m.scheduledAt), m.location].filter(Boolean).join(" · ");
}

/**
 * A singles match on match day, with "Record with Ball Boi" as its primary
 * action (spec: Ball Boi > Recording).
 */
export function TodaysMatchCard({ match, onRecord }: { match: RecordableMatch; onRecord: () => void }) {
  const meta = matchMeta(match);
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View accessible accessibilityLabel={`Match vs ${match.opponentName}. ${meta}`} style={{ gap: spacing.space1 }}>
        <Text variant="bodyStrong">vs {match.opponentName}</Text>
        <Text variant="small" tone="inkMuted">
          {meta}
        </Text>
      </View>
      <Button
        label="Record with Ball Boi"
        accessibilityLabel={`Record with Ball Boi, match vs ${match.opponentName}`}
        onPress={onRecord}
      />
    </Card>
  );
}
