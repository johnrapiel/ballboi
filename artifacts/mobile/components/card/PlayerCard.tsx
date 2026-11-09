import React from "react";
import { Pressable, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import type { PlayerCard as Card } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MilestoneBadge } from "@/components/MilestoneBadge";
import { Pill, Text, TextLink } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { photoUrl } from "@/lib/photos";
import { knownMilestones } from "@/lib/milestones";
import { ADD_HOME_COURT, ADD_PLAYS, bottomRow, cardPrompts, cardSpoken, levelPill, playsPill, townLine } from "@/lib/playerCard";

// The player card, design D "Portrait" (spec decision 139, John, Nov 8;
// canvas W2_ProfileCard). The same card everywhere: Profile and Discover.
// A court drawing across the top with the photo (initials fallback) over it,
// the name in full ink Cormorant (#181), Level and Plays pills, the town,
// a small row of earned milestone badges (decision 150), then the home court
// on the left and Free times on the right. Besides the badges, it holds only
// what the player entered.
//
// Prompts in place (John, Nov 9): on your own card, an unset home court or
// Plays shows a light link in its spot ("Add home court", "Add how you
// play") that opens the same editor Edit profile uses. Someone else's card
// leaves those spots out, and Free times alone sits left-aligned.
//
// VoiceOver reads the card as one element, then the prompts, Free times and
// the pencil (your own card) as their own buttons.

/** A light link that's a button: 44pt target, words not color alone. */
function Prompt({ label, hint, onPress, icon, small }: { label: string; hint: string; onPress: () => void; icon?: boolean; small?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      // Beside a pill the row stays pill height; the slop keeps the target 44pt.
      hitSlop={small ? { top: 10, bottom: 10 } : undefined}
      style={({ pressed }) => ({
        minHeight: small ? 26 : MIN_TAP,
        minWidth: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        flexShrink: 1,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {icon ? <Icon name="mappin.and.ellipse" size={22} tintColor={c.court} /> : null}
      {/* The words take the same press; the Pressable around them is the one VoiceOver button. */}
      <TextLink onPress={onPress} accessible={false} variant={small ? "small" : "body"} style={{ flexShrink: 1 }}>
        {label}
      </TextLink>
    </Pressable>
  );
}

/** The court drawn across the top of the card, in the hairline ink on sand. */
function CourtDrawing() {
  const c = useColors();
  return (
    <View style={{ height: 140, width: "100%", backgroundColor: c.sand }}>
      <Svg width="100%" height="100%" viewBox="0 0 340 140" preserveAspectRatio="none">
        <Rect x={44} y={20} width={252} height={100} rx={2} stroke={c.hairlineStrong} strokeWidth={1.5} fill="none" />
        <Line x1={44} y1={36} x2={296} y2={36} stroke={c.hairlineStrong} strokeWidth={1.5} />
        <Line x1={44} y1={104} x2={296} y2={104} stroke={c.hairlineStrong} strokeWidth={1.5} />
        <Line x1={110} y1={36} x2={110} y2={104} stroke={c.hairlineStrong} strokeWidth={1.5} />
        <Line x1={230} y1={36} x2={230} y2={104} stroke={c.hairlineStrong} strokeWidth={1.5} />
        <Line x1={110} y1={70} x2={230} y2={70} stroke={c.hairlineStrong} strokeWidth={1.5} />
        <Line x1={170} y1={20} x2={170} y2={120} stroke={c.hairlineStrong} strokeWidth={1.5} strokeDasharray="3 4" />
      </Svg>
    </View>
  );
}

export function PlayerCard({
  card,
  onEdit,
  onFreeTimes,
  onAddHomeCourt,
  onAddPlays,
}: {
  card: Card;
  /** Your own card: the pencil, which opens Edit profile. */
  onEdit?: () => void;
  /** Opens the Free times sheet. Hidden on someone else's card with no free times. */
  onFreeTimes: () => void;
  /** Your own card with no home court: opens the home court picker. */
  onAddHomeCourt?: () => void;
  /** Your own card with no Plays: opens the Plays editor. */
  onAddPlays?: () => void;
}) {
  const c = useColors();
  const level = levelPill(card.rating);
  const plays = playsPill(card.plays);
  const where = townLine(card);
  const prompts = cardPrompts(card);
  const askPlays = prompts.plays && !!onAddPlays;
  const row = bottomRow(card);
  const askCourt = row?.left === "prompt" && !!onAddHomeCourt;
  const first = card.name.split(" ")[0] || card.name;
  const badges = knownMilestones(card.milestones);

  return (
    <View
      style={{
        backgroundColor: c.linen,
        borderRadius: radius.radiusCard,
        borderWidth: 1,
        borderColor: c.hairline,
        overflow: "hidden",
        alignItems: "center",
        // With no bottom row the card ends on its badges or town; keep the same air as above them.
        paddingBottom: row ? spacing.space1 : spacing.space4,
      }}
    >
      <View accessible accessibilityLabel={cardSpoken(card)} style={{ alignItems: "center", width: "100%" }}>
        <CourtDrawing />
        <View style={{ marginTop: -56, borderRadius: radius.radiusPill, borderWidth: 4, borderColor: c.linen, backgroundColor: c.linen }}>
          <Avatar name={card.name} uri={photoUrl(card.avatarUrl)} size={96} />
        </View>
        {/* A player's name is always full ink, never the 50% title style (#181). */}
        <Text
          variant="title"
          style={{ fontSize: 30, lineHeight: 34, marginTop: spacing.space3, marginBottom: 10, paddingHorizontal: spacing.space4, textAlign: "center" }}
        >
          {card.name}
        </Text>
      </View>

      {/* The pills: already read with the card, so VoiceOver skips them. Only the prompt is its own button. */}
      {level || plays || askPlays ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: spacing.space3, rowGap: spacing.space2, paddingHorizontal: spacing.space4 }}>
          {level ? <Pill label={level} style={{ alignSelf: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null}
          {plays ? <Pill label={plays} style={{ alignSelf: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null}
          {askPlays ? <Prompt label={ADD_PLAYS} hint="Singles, doubles, or both" onPress={onAddPlays!} small /> : null}
        </View>
      ) : null}

      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: "center", width: "100%" }}>
        {where ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.space1, marginTop: spacing.space2, paddingHorizontal: spacing.space4 }}>
            <Icon name="mappin.and.ellipse" size={16} tintColor={c.inkMuted} />
            <Text variant="small" tone="inkMuted" style={{ flexShrink: 1, textAlign: "center" }}>
              {where}
            </Text>
          </View>
        ) : null}
        {/* Earned milestones (decision 150): read with the card's summary, so decorative here. */}
        {badges.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.space2, marginTop: spacing.space3, paddingHorizontal: spacing.space4 }}>
            {badges.map((m) => (
              <MilestoneBadge key={m.kind} kind={m.kind} size={32} />
            ))}
          </View>
        ) : null}
      </View>

      {row ? (
        <View style={{ width: "100%", paddingHorizontal: 20, marginTop: spacing.space4 }}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              // One item alone sits left as a footer, so it never looks stranded on the right.
              justifyContent: row.align === "split" && (row.left !== "prompt" || askCourt) ? "space-between" : "flex-start",
              columnGap: spacing.space3,
              borderTopWidth: 1,
              borderTopColor: c.hairline,
            }}
          >
            {row.left === "court" ? (
              // Already read with the card, so VoiceOver skips it here.
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: MIN_TAP, flexShrink: 1 }}
              >
                <Icon name="sportscourt" size={22} tintColor={c.ink} />
                <Text style={{ flexShrink: 1 }}>{card.homeCourt}</Text>
              </View>
            ) : askCourt ? (
              <Prompt label={ADD_HOME_COURT} hint="Pick the court you usually play at" onPress={onAddHomeCourt!} icon />
            ) : null}
            {row.free ? (
              <Pressable
                onPress={onFreeTimes}
                accessibilityRole="button"
                accessibilityLabel={card.you ? "Free times" : `${first}'s free times`}
                accessibilityHint={card.you ? "Shows when you're usually free" : `Shows when ${first} is usually free`}
                style={({ pressed }) => ({
                  minHeight: MIN_TAP,
                  minWidth: MIN_TAP,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.space2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Icon name="square.grid.3x3" size={22} tintColor={c.ink} />
                <Text>Free times</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          hitSlop={4}
          style={({ pressed }) => ({
            position: "absolute",
            top: 6,
            right: 6,
            width: MIN_TAP,
            height: MIN_TAP,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="pencil" size={24} tintColor={c.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}
