import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import type { BracketRound, BracketSeed, BracketSlot, LeagueBracket } from "@workspace/api-client-react";

import { Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { deadlineDate } from "@/lib/leagueSchedule";
import { slotActions, slotResult } from "@/lib/playoffView";

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

function slotSummary(slot: BracketSlot, round: BracketRound, myPlayerId: number | null | undefined, ended: boolean): string {
  const name = (p: BracketSeed | null) => (p ? `seed ${p.seed}, ${p.playerName}${p.playerId === myPlayerId ? ", you" : ""}` : "to be decided");
  const base = `${ROUND_SINGULAR[slot.round]}: ${name(slot.player1)} versus ${name(slot.player2)}.`;
  return `${base} ${slotResult(slot, round, ended)}.`;
}

function SlotButton({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text variant="button" style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function BracketView({
  bracket,
  myPlayerId,
  onEnterScore,
  onSettle,
  isAdmin = false,
  ended = false,
  timeZone,
}: {
  bracket: LeagueBracket;
  myPlayerId: number | null | undefined;
  onEnterScore: (matchId: number) => void;
  /** Admin, after a round's play-by date: enter the result or a walkover (Q5b). */
  onSettle?: (slot: BracketSlot) => void;
  isAdmin?: boolean;
  /** C15, C24: an ended league's bracket offers nothing to enter. */
  ended?: boolean;
  timeZone?: string | null;
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
          <View style={{ gap: 2 }}>
            <Text variant="label" tone="inkMuted" accessibilityRole="header">
              {ROUND_LABEL[r.round]}
            </Text>
            {/* Q5b: two weeks per round. */}
            {r.playBy && !ended && r.slots.some((s) => s.status !== "completed") ? (
              <Text variant="small" tone="inkMuted">
                {r.pastPlayBy ? `Play-by date was ${deadlineDate(r.playBy, timeZone)}` : `Play by ${deadlineDate(r.playBy, timeZone)}`}
              </Text>
            ) : null}
          </View>
          {r.slots.map((slot) => {
            const mine = myPlayerId != null && (slot.player1?.playerId === myPlayerId || slot.player2?.playerId === myPlayerId);
            const can = slotActions(slot, r, { myPlayerId, isAdmin, ended });
            return (
              <Card key={`${r.round}-${slot.slot}`} style={{ gap: spacing.space1, backgroundColor: mine ? c.sand : c.linen }}>
                <View accessible accessibilityLabel={slotSummary(slot, r, myPlayerId, ended)} style={{ gap: spacing.space1 }}>
                  <PlayerLine p={slot.player1} won={slot.winnerId != null && slot.winnerId === slot.player1?.playerId} me={slot.player1?.playerId === myPlayerId} />
                  <View style={{ height: 1, backgroundColor: c.hairline }} />
                  <PlayerLine p={slot.player2} won={slot.winnerId != null && slot.winnerId === slot.player2?.playerId} me={slot.player2?.playerId === myPlayerId} />
                  <Text variant="small" tone="inkMuted">
                    {slotResult(slot, r, ended)}
                  </Text>
                </View>
                {can.enterScore ? (
                  <SlotButton label="Enter score" hint={`For your ${ROUND_SINGULAR[r.round].toLowerCase()}`} onPress={() => onEnterScore(slot.matchId!)} />
                ) : null}
                {can.settle && onSettle ? (
                  <SlotButton label="Enter result" hint="Enter the score or a walkover" onPress={() => onSettle(slot)} />
                ) : null}
              </Card>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** The signed-in player's playoff match that still needs a score, if any, with its round's play-by date. */
export function myPlayoffMatch(bracket: LeagueBracket | null | undefined, myPlayerId: number | null | undefined) {
  if (!bracket || myPlayerId == null) return null;
  for (const r of bracket.rounds) {
    for (const slot of r.slots) {
      const mine = slot.player1?.playerId === myPlayerId || slot.player2?.playerId === myPlayerId;
      if (mine && slot.matchId != null && slot.status !== "completed") {
        const opponent = slot.player1?.playerId === myPlayerId ? slot.player2 : slot.player1;
        return { slot, opponent, playBy: r.playBy, pastPlayBy: r.pastPlayBy };
      }
    }
  }
  return null;
}
