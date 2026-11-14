import React from "react";
import { View, useWindowDimensions } from "react-native";

import type { Standing } from "@workspace/api-client-react";

import { BrushRing } from "@/components/BrushRing";
import { Card, Chip, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isAccessibilityTextSize } from "@/lib/leaguePage";
import { ordinal } from "@/lib/leagues";

/** D3: a fixed-partner team's row: yours when you're on it; VoiceOver reads "&" as "and". */
const onRow = (s: Standing, me: number | null | undefined) => me != null && (s.playerId === me || !!s.teamPlayerIds?.includes(me));
const spokenName = (s: Standing) => (s.teamId != null ? s.playerName.replace(/ & /g, " and ") : s.playerName);

// Standings rank on wins, then head to head between players level on wins,
// then share of sets and games won (John, Nov 6; spec: Leagues > Scores and
// standings). Players share a rank only when all of those are level. The rank
// and W–L sit in Cormorant, your rank in a brush ring, as on the approved
// League detail · Standings screen. Each row reads as one VoiceOver element.
// Doubles (D3): fixed-partner leagues list teams ("John Rapiel & Sam Lee"),
// rotating leagues list players.
// Before the league starts every player or team is listed with dashes, like
// the league cards (L3, Nov 14). At the accessibility text sizes the table
// drops to place, name and record: the You chip steps away and your row keeps
// the brush ring and the shading, so it's still not marked by color alone (L9).

// The approved table sets rank and W–L at 22pt Cormorant: scoreRow's face at a
// row's size.
const RANK = { fontSize: 22, lineHeight: 26 } as const;

function Row({ s, isMe, tied, last, beforeStart, compact }: { s: Standing; isMe: boolean; tied: boolean; last: boolean; beforeStart: boolean; compact: boolean }) {
  const c = useColors();
  const dash = "–";
  const place = beforeStart ? dash : tied ? `T${s.rank}` : String(s.rank);
  const you = isMe ? (s.teamId != null ? ", your team" : ", you") : "";
  return (
    <View
      accessible
      accessibilityLabel={
        beforeStart
          ? `${spokenName(s)}${you}. Not ranked yet`
          : `${tied ? "Tied " : ""}${ordinal(s.rank)}, ${spokenName(s)}${you}. ${s.wins} ${s.wins === 1 ? "win" : "wins"}, ${s.losses} ${s.losses === 1 ? "loss" : "losses"}`
      }
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        // Your own row is shaded, as on Home (app gap 6).
        backgroundColor: isMe ? c.sand : undefined,
      }}
    >
      <View style={{ minWidth: 32, alignItems: "flex-start" }}>
        {isMe ? (
          <BrushRing size={28}>
            <Text variant="scoreRow" style={RANK} maxFontSizeMultiplier={1.5}>
              {place}
            </Text>
          </BrushRing>
        ) : (
          <Text variant="scoreRow" tone="inkMuted" style={RANK} maxFontSizeMultiplier={1.5}>
            {place}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.space2, flexWrap: "wrap" }}>
        <Text variant="bodyStrong">{s.playerName}</Text>
        {isMe && !compact ? <Chip label={s.teamId != null ? "Your team" : "You"} tone="ink" /> : null}
      </View>
      <Text variant="scoreRow" style={[RANK, { minWidth: 56, textAlign: "right" }]} maxFontSizeMultiplier={1.5}>
        {beforeStart ? dash : `${s.wins}–${s.losses}`}
      </Text>
    </View>
  );
}

export function StandingsTable({
  standings,
  myPlayerId,
  beforeStart = false,
}: {
  standings: Standing[];
  myPlayerId: number | null | undefined;
  /** The league hasn't started: every row shows dashes (L3). */
  beforeStart?: boolean;
}) {
  const c = useColors();
  const compact = isAccessibilityTextSize(useWindowDimensions().fontScale);
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
        <View style={{ minWidth: 32 }} />
        <Text variant="label" tone="inkMuted" style={{ flex: 1 }}>
          {standings.some((s) => s.teamId != null) ? "Team" : "Player"}
        </Text>
        <Text variant="label" tone="inkMuted" style={{ minWidth: 56, textAlign: "right" }}>
          W–L
        </Text>
      </View>
      {standings.map((s, i) => (
        <Row
          key={s.playerId}
          s={s}
          isMe={onRow(s, myPlayerId)}
          tied={(counts.get(s.rank) ?? 0) > 1}
          last={i === standings.length - 1}
          beforeStart={beforeStart}
          compact={compact}
        />
      ))}
    </Card>
  );
}
