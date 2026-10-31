import React from "react";
import { View } from "react-native";

import type { Standing } from "@workspace/api-client-react";

import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { ordinal } from "@/lib/leagues";

// Standings rank on wins only; ties share a rank (spec: Leagues > Scores and
// standings, decision 23). Each row reads as one VoiceOver element.

function Row({ s, isMe, tied, last }: { s: Standing; isMe: boolean; tied: boolean; last: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${tied ? "Tied " : ""}${ordinal(s.rank)}, ${s.playerName}${isMe ? ", you" : ""}. ${s.wins} ${
        s.wins === 1 ? "win" : "wins"
      }, ${s.losses} ${s.losses === 1 ? "loss" : "losses"}`}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        backgroundColor: isMe ? c.sand : "transparent",
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text variant="titleItalic" tone={isMe ? "ink" : "inkMuted"} style={{ minWidth: 32 }} maxFontSizeMultiplier={1.5}>
        {tied ? `T${s.rank}` : s.rank}
      </Text>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.space2, flexWrap: "wrap" }}>
        <Text variant="bodyStrong">{s.playerName}</Text>
        {isMe ? (
          <Text variant="label" tone="inkMuted">
            You
          </Text>
        ) : null}
      </View>
      <Text variant="title" style={{ minWidth: 56, textAlign: "right", fontVariant: ["lining-nums", "tabular-nums"] }} maxFontSizeMultiplier={1.5}>
        {`${s.wins}–${s.losses}`}
      </Text>
    </View>
  );
}

export function StandingsTable({ standings, myPlayerId }: { standings: Standing[]; myPlayerId: number | null | undefined }) {
  const c = useColors();
  const counts = new Map<number, number>();
  for (const s of standings) counts.set(s.rank, (counts.get(s.rank) ?? 0) + 1);
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          flexDirection: "row",
          gap: spacing.space3,
          paddingHorizontal: spacing.space4,
          paddingVertical: spacing.space2,
          borderBottomWidth: 1,
          borderBottomColor: c.hairlineStrong,
        }}
      >
        <Text variant="label" tone="inkMuted" style={{ minWidth: 32 }}>
          #
        </Text>
        <Text variant="label" tone="inkMuted" style={{ flex: 1 }}>
          Player
        </Text>
        <Text variant="label" tone="inkMuted" style={{ minWidth: 56, textAlign: "right" }}>
          W–L
        </Text>
      </View>
      {standings.map((s, i) => (
        <Row
          key={s.playerId}
          s={s}
          isMe={s.playerId === myPlayerId}
          tied={(counts.get(s.rank) ?? 0) > 1}
          last={i === standings.length - 1}
        />
      ))}
    </Card>
  );
}
