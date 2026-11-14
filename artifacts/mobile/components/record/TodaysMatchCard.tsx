import React from "react";
import { View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { deadlineDate } from "@/lib/leagueSchedule";
import { matchSourceLabel, matchTime, type RecordableMatch } from "@/lib/recording/api";

/**
 * "Tuesday Flex · 6:00 PM · Memorial Park", or "Open match · 6 PM" (whichever parts exist). A league
 * match with no time yet says when to play by: "Tuesday Flex · Play by Sun, Nov 8".
 */
export function matchMeta(m: RecordableMatch): string {
  const when = matchTime(m.scheduledAt) ?? (m.playBy ? `Play by ${deadlineDate(m.playBy, m.timeZone)}` : null);
  return [matchSourceLabel(m), when, m.location].filter(Boolean).join(" · ");
}

/**
 * A singles match you can record now, with "Record with Ball Boi" as its
 * primary action (spec: Ball Boi > Recording).
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
