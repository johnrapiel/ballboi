import React from "react";
import { Pressable, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import type { PlayerCard as Card } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Pill, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { photoUrl } from "@/lib/photos";
import { cardSpoken, levelPill, playsPill, townLine } from "@/lib/playerCard";

// The player card, design D "Portrait" (spec decision 139, John, Nov 8;
// canvas W2_ProfileCard). The same card everywhere: Profile and Discover.
// A court drawing across the top with the photo (initials fallback) over it,
// the name in full ink Cormorant (#181), Level and Plays pills, the town,
// then the home court on the left and Free times on the right. It holds only
// what the player entered.
//
// VoiceOver reads the card as one element, then the pencil (your own card)
// and Free times as their own controls.

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
}: {
  card: Card;
  /** Your own card: the pencil, which opens Edit profile. */
  onEdit?: () => void;
  /** Opens the Free times sheet. Hidden on someone else's card with no free times. */
  onFreeTimes: () => void;
}) {
  const c = useColors();
  const level = levelPill(card.rating);
  const plays = playsPill(card.plays);
  const where = townLine(card);
  const showFree = card.you || card.slots.length > 0;
  const first = card.name.split(" ")[0] || card.name;

  return (
    <View
      style={{
        backgroundColor: c.linen,
        borderRadius: radius.radiusCard,
        borderWidth: 1,
        borderColor: c.hairline,
        overflow: "hidden",
        alignItems: "center",
        paddingBottom: spacing.space1,
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
        {level || plays ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.space2, paddingHorizontal: spacing.space4 }}>
            {level ? <Pill label={level} style={{ alignSelf: "center" }} /> : null}
            {plays ? <Pill label={plays} style={{ alignSelf: "center" }} /> : null}
          </View>
        ) : null}
        {where ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.space1, marginTop: spacing.space2, paddingHorizontal: spacing.space4 }}>
            <Icon name="mappin.and.ellipse" size={16} tintColor={c.inkMuted} />
            <Text variant="small" tone="inkMuted" style={{ flexShrink: 1, textAlign: "center" }}>
              {where}
            </Text>
          </View>
        ) : null}
      </View>

      {card.homeCourt || showFree ? (
        <View
          style={{
            width: "100%",
            paddingHorizontal: 20,
            marginTop: spacing.space4,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              columnGap: spacing.space3,
              borderTopWidth: 1,
              borderTopColor: c.hairline,
            }}
          >
            {/* Already read with the card, so VoiceOver skips it here. */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: MIN_TAP, flexShrink: 1 }}
            >
              {card.homeCourt ? (
                <>
                  <Icon name="sportscourt" size={22} tintColor={c.ink} />
                  <Text style={{ flexShrink: 1 }}>{card.homeCourt}</Text>
                </>
              ) : null}
            </View>
            {showFree ? (
              <Pressable
                onPress={onFreeTimes}
                accessibilityRole="button"
                accessibilityLabel={card.you ? "Free times" : `${first}'s free times`}
                accessibilityHint={card.you ? "Shows the hours you're usually free" : `Shows the hours ${first} is usually free`}
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
