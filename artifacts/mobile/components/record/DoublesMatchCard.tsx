import { useAuth } from "@clerk/expo";
import { SymbolView } from "expo-symbols";
import React, { useEffect } from "react";
import { View } from "react-native";

import { matchMeta } from "@/components/record/TodaysMatchCard";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { DOUBLES_MESSAGE, logDoublesView, type RecordableMatch } from "@/lib/recording/api";

/**
 * A doubles match on match day. Ball Boi is disabled, and the reason is
 * visible text that VoiceOver reads, not just a dimmed button
 * (spec: Ball Boi > Recording, Doubles). Each view is logged as demand.
 */
export function DoublesMatchCard({ match }: { match: RecordableMatch }) {
  const c = useColors();
  const { getToken } = useAuth();

  useEffect(() => {
    logDoublesView(match.id, getToken);
  }, [match.id, getToken]);

  const meta = matchMeta(match);
  const partner = match.partnerName ? ` with ${match.partnerName}` : "";
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View
        accessible
        accessibilityLabel={`Doubles${partner} vs ${match.opponentName}. ${meta}`}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="bodyStrong">
          Doubles{partner} vs {match.opponentName}
        </Text>
        <Text variant="small" tone="inkMuted">
          {meta}
        </Text>
      </View>
      <Button label="Record with Ball Boi" disabled accessibilityHint={DOUBLES_MESSAGE} />
      <View
        accessible
        accessibilityLabel={DOUBLES_MESSAGE}
        style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }}
      >
        <SymbolView name="info.circle" size={16} tintColor={c.inkMuted} style={{ marginTop: 3 }} />
        <Text variant="small" tone="inkMuted" style={{ flex: 1 }}>
          {DOUBLES_MESSAGE}
        </Text>
      </View>
    </Card>
  );
}
