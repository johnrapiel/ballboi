import { Icon } from "@/components/Icon";
import React, { useEffect } from "react";
import { View } from "react-native";

import { matchMeta } from "@/components/record/TodaysMatchCard";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useStableGetToken } from "@/hooks/useStableGetToken";
import { DOUBLES_MESSAGE, logDoublesView, type RecordableMatch } from "@/lib/recording/api";

/**
 * A doubles match on match day. Ball Boi is disabled, and the reason is
 * visible text that VoiceOver reads, not just a dimmed button
 * (spec: Ball Boi > Recording, Doubles). Each view is logged as demand.
 */
export function DoublesMatchCard({ match }: { match: RecordableMatch }) {
  const getToken = useStableGetToken();

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
      <DoublesRecordButton matchId={match.id} logView={false} />
    </Card>
  );
}

/**
 * Home's D2 card on a doubles match: just the reason, as a quiet line, with no
 * dimmed button (design audit, Nov 7). Logs the view as demand.
 */
export function DoublesNote({ matchId }: { matchId: number }) {
  const c = useColors();
  const getToken = useStableGetToken();

  useEffect(() => {
    logDoublesView(matchId, getToken);
  }, [matchId, getToken]);

  return (
    <View
      accessible
      accessibilityLabel={DOUBLES_MESSAGE}
      style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start", justifyContent: "center" }}
    >
      <Icon name="info.circle" size={16} tintColor={c.inkMuted} style={{ marginTop: 3 }} />
      <Text variant="small" tone="inkMuted" style={{ flexShrink: 1 }}>
        {DOUBLES_MESSAGE}
      </Text>
    </View>
  );
}

/**
 * The dimmed "Record with Ball Boi" button on a doubles match, with the reason
 * as visible text that VoiceOver reads. Used on the Ball Boi tab. Logs the view as demand unless the caller already does.
 */
export function DoublesRecordButton({ matchId, logView = true }: { matchId: number; logView?: boolean }) {
  const c = useColors();
  const getToken = useStableGetToken();

  useEffect(() => {
    if (logView) logDoublesView(matchId, getToken);
  }, [logView, matchId, getToken]);

  return (
    <View style={{ gap: spacing.space2 }}>
      <Button label="Record with Ball Boi" disabled accessibilityHint={DOUBLES_MESSAGE} />
      <View
        accessible
        accessibilityLabel={DOUBLES_MESSAGE}
        style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }}
      >
        <Icon name="info.circle" size={16} tintColor={c.inkMuted} style={{ marginTop: 3 }} />
        <Text variant="small" tone="inkMuted" style={{ flex: 1 }}>
          {DOUBLES_MESSAGE}
        </Text>
      </View>
    </View>
  );
}
