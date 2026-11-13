import React from "react";
import { Pressable, View } from "react-native";

import type { BracketRound, BracketSeed, BracketSlot, LeagueBracket } from "@workspace/api-client-react";

import { BrushRing } from "@/components/BrushRing";
import { Card, Text, textLinkColor } from "@/components/ui";
import { MarkedName } from "@/components/WinnerNames";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { deadlineDate } from "@/lib/leagueSchedule";
import { slotActions, slotResult } from "@/lib/playoffView";
import { sideOf, winnerMark, type NameStyle } from "@/lib/winnerMark";

// Playoff bracket (spec: Leagues > Setup, optional playoff for top 4 or 8;
// canvas: Playoff bracket). A list by round rather than a drawn tree, so it
// reads top to bottom with VoiceOver and at any text size. Approved styling
// (John, Nov 5): the original linen match boxes, italic serif seeds and sand
// highlight on your match, sentence case labels and You, and the brush ring
// around the italic serif Champion. Winners are marked with the brush
// underline, not a Won tag (John, Nov 8).

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

function PlayerLine({ p, look, me }: { p: BracketSeed | null; look: NameStyle; me: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: 32 }}>
      <Text variant="titleItalic" tone="inkMuted" style={{ minWidth: 22 }} maxFontSizeMultiplier={1.5}>
        {p ? String(p.seed) : ""}
      </Text>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.space2 }}>
        {p ? (
          // Winner mark (John, Nov 8): bold with the brush underline, the loser muted.
          <MarkedName name={p.playerName} look={look} />
        ) : (
          <Text tone="inkMuted">To be decided</Text>
        )}
        {p && me ? (
          <Text variant="section" tone="inkMuted">
            You
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The slot's winner mark: who's marked, the score line, and what VoiceOver reads. */
function slotMark(slot: BracketSlot, round: BracketRound, ended: boolean) {
  const result = slotResult(slot, round, ended);
  const side = slot.status === "completed" ? sideOf(slot.winnerId, slot.player1?.playerId, slot.player2?.playerId) : null;
  return winnerMark({
    player1Name: slot.player1?.playerName ?? "To be decided",
    player2Name: slot.player2?.playerName ?? "To be decided",
    score: side ? slot.score : null,
    winner: side,
    status: side ? undefined : result,
  });
}

function slotSummary(slot: BracketSlot, round: BracketRound, myPlayerId: number | null | undefined, ended: boolean): string {
  const name = (p: BracketSeed | null) => (p ? `seed ${p.seed}, ${p.playerName}${p.playerId === myPlayerId ? ", you" : ""}` : "to be decided");
  const base = `${ROUND_SINGULAR[slot.round]}: ${name(slot.player1)} versus ${name(slot.player2)}.`;
  return `${base} ${slotMark(slot, round, ended).spoken}.`;
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
      {/* Enter score and Enter result change the match: the green action link (decision 201). */}
      <Text variant="button" tone={textLinkColor("action")} style={{ textDecorationLine: "underline" }}>
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
        <Card accessible accessibilityLabel={`Champion: ${bracket.champion.playerName}`} style={{ alignItems: "center", gap: spacing.space2 }}>
          <BrushRing size={36} style={{ paddingHorizontal: spacing.space3 }}>
            <Text variant="titleItalic" maxFontSizeMultiplier={1.5}>
              Champion
            </Text>
          </BrushRing>
          <Text variant="title">{bracket.champion.playerName}</Text>
        </Card>
      ) : null}
      {bracket.rounds.map((r) => (
        <View key={r.round} style={{ gap: spacing.space2 }}>
          <View style={{ gap: 2 }}>
            <Text variant="section" tone="inkMuted" accessibilityRole="header">
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
            const mark = slotMark(slot, r, ended);
            return (
              <Card key={`${r.round}-${slot.slot}`} style={{ gap: spacing.space1, backgroundColor: mine ? c.sand : c.linen }}>
                <View accessible accessibilityLabel={slotSummary(slot, r, myPlayerId, ended)} style={{ gap: spacing.space1 }}>
                  <PlayerLine p={slot.player1} look={mark.player1} me={slot.player1?.playerId === myPlayerId} />
                  <View style={{ height: 1, backgroundColor: c.hairline }} />
                  <PlayerLine p={slot.player2} look={mark.player2} me={slot.player2?.playerId === myPlayerId} />
                  <Text variant="small" tone="inkMuted" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
                    {mark.line}
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
