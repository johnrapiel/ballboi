import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import type { BracketSeed, BracketSlot, LeagueBracket } from "@workspace/api-client-react";

import { Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Playoff bracket (spec: Leagues > Setup, optional playoff for top 4 or 8;
// canvas: Playoff bracket). A list by round rather than a drawn tree, so it
// reads top to bottom with VoiceOver and at any text size.

export const ROUND_LABEL: Record<BracketSlot["round"], string> = {
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  final: "Final",
};

export const ROUND_SINGULAR: Record<BracketSlot["round"], string> = {
  quarterfinal: "Quarterfinal",
  semifinal: "Semifinal",
  final: "Final",
};

/** Score as the given player sees it: their games first. */
function fromSide(score: string, slot: BracketSlot, playerId: number): string {
  if (slot.player1?.playerId === playerId) return score;
  return score
    .split(",")
    .map((set) => {
      const x = set.trim().match(/^(\d+)-(\d+)(\(\d+\))?$/);
      return x ? `${x[2]}-${x[1]}${x[3] ?? ""}` : set.trim();
    })
    .join(", ");
}

function PlayerLine({ p, won, me }: { p: BracketSeed | null; won: boolean; me: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: 32 }}>
      <Text variant="titleItalic" tone="inkMuted" style={{ minWidth: 22 }} maxFontSizeMultiplier={1.5}>
        {p ? String(p.seed) : ""}
      </Text>
      <Text variant={won ? "bodyStrong" : "body"} tone={p ? "ink" : "inkMuted"} style={{ flex: 1 }}>
        {p ? `${p.playerName}${me ? " (you)" : ""}` : "To be decided"}
      </Text>
      {won ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
          <SymbolView name="checkmark" size={12} tintColor={c.ink} />
          <Text variant="label">Won</Text>
        </View>
      ) : null}
    </View>
  );
}

function slotSummary(slot: BracketSlot, myPlayerId: number | null | undefined): string {
  const name = (p: BracketSeed | null) => (p ? `seed ${p.seed}, ${p.playerName}${p.playerId === myPlayerId ? ", you" : ""}` : "to be decided");
  const base = `${ROUND_SINGULAR[slot.round]}: ${name(slot.player1)} versus ${name(slot.player2)}.`;
  if (slot.winnerId != null && slot.score) {
    const winner = slot.player1?.playerId === slot.winnerId ? slot.player1 : slot.player2;
    return `${base} ${winner?.playerName ?? "Winner"} won ${fromSide(slot.score, slot, slot.winnerId)}.`;
  }
  return slot.matchId ? `${base} Not played yet.` : base;
}

export function BracketView({
  bracket,
  myPlayerId,
  onEnterScore,
}: {
  bracket: LeagueBracket;
  myPlayerId: number | null | undefined;
  onEnterScore: (matchId: number) => void;
}) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.space3 }}>
      {bracket.champion ? (
        <Card accessible accessibilityLabel={`Champion: ${bracket.champion.playerName}`} style={{ alignItems: "center", gap: spacing.space1 }}>
          <Text variant="label" tone="inkMuted">
            Champion
          </Text>
          <Text variant="title">{bracket.champion.playerName}</Text>
        </Card>
      ) : null}
      {bracket.rounds.map((r) => (
        <View key={r.round} style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted" accessibilityRole="header">
            {ROUND_LABEL[r.round]}
          </Text>
          {r.slots.map((slot) => {
            const mine = myPlayerId != null && (slot.player1?.playerId === myPlayerId || slot.player2?.playerId === myPlayerId);
            const scoreable = mine && slot.matchId != null && slot.status !== "completed";
            const result =
              slot.winnerId != null && slot.score
                ? `${(slot.player1?.playerId === slot.winnerId ? slot.player1 : slot.player2)?.playerName ?? "Winner"} won ${fromSide(slot.score, slot, slot.winnerId)}`
                : slot.matchId
                  ? "Not played yet"
                  : "Waiting on earlier matches";
            return (
              <Card key={`${r.round}-${slot.slot}`} style={{ gap: spacing.space1, backgroundColor: mine ? c.sand : c.linen }}>
                <View accessible accessibilityLabel={slotSummary(slot, myPlayerId)} style={{ gap: spacing.space1 }}>
                  <PlayerLine p={slot.player1} won={slot.winnerId != null && slot.winnerId === slot.player1?.playerId} me={slot.player1?.playerId === myPlayerId} />
                  <View style={{ height: 1, backgroundColor: c.hairline }} />
                  <PlayerLine p={slot.player2} won={slot.winnerId != null && slot.winnerId === slot.player2?.playerId} me={slot.player2?.playerId === myPlayerId} />
                  <Text variant="small" tone="inkMuted">
                    {result}
                  </Text>
                </View>
                {scoreable ? (
                  <Pressable
                    onPress={() => onEnterScore(slot.matchId!)}
                    accessibilityRole="button"
                    accessibilityLabel="Enter score"
                    accessibilityHint={`For your ${ROUND_SINGULAR[r.round].toLowerCase()}`}
                    style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text variant="button" style={{ textDecorationLine: "underline" }}>
                      Enter score
                    </Text>
                  </Pressable>
                ) : null}
              </Card>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The signed-in player's playoff match that still needs a score, if any. */
export function myPlayoffMatch(bracket: LeagueBracket | null | undefined, myPlayerId: number | null | undefined) {
  if (!bracket || myPlayerId == null) return null;
  for (const r of bracket.rounds) {
    for (const slot of r.slots) {
      const mine = slot.player1?.playerId === myPlayerId || slot.player2?.playerId === myPlayerId;
      if (mine && slot.matchId != null && slot.status !== "completed") {
        const opponent = slot.player1?.playerId === myPlayerId ? slot.player2 : slot.player1;
        return { slot, opponent };
      }
    }
  }
  return null;
}
