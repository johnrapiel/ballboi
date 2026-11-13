import { andJoin, firstName, versusSpoken } from "@/lib/doubles";
import React from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MatchTimeLink } from "@/components/MatchTimeLink";
import { MatchActions, type MatchAction } from "@/components/MatchActions";
import { Pill, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MATCH_CARD_HINT, matchCardSpoken } from "@/lib/matchActions";

// Next match card D2 (approved design audit, Home, John, Nov 6): one plain
// card with the standard light hairline border (Nov 7) with no inner boxes, all centred in one flow. The date, a big
// serif time, both faces overlapped, "You vs. Mike", the court with a pin, the
// league as an outline pill, then the buttons.
//
// Buttons (Wave 2 finding 54, decision 199, John, Nov 12: "It should be
// constant"): the same actions everywhere this card appears, drawn by
// MatchActions. Record with Ball Boi (when it can be recorded), then Message
// and Enter score. Past due (finding 47: an hour after the start, no score),
// Enter score and Message lead and Record with Ball Boi is a text link.
// There's no Details button: on Home the whole card is tappable and opens
// Match detail (VoiceOver: one button that reads the match, hint "Opens match
// details"); the buttons inside stay their own elements, and tapping one
// doesn't also open the card. On Match detail the card isn't tappable.
// Match time is link text right under the date line, not a button (Wave 2
// finding 25, John, Nov 12).
//
// The audit overrides anything built that doesn't match it (John, Nov 7).

export type NextMatchAction = MatchAction;

export function NextMatchCard({
  dateLabel,
  time,
  myName,
  myPhoto,
  opponentPhoto,
  opponentName,
  partnerName,
  opponentNames,
  location,
  league,
  note,
  record,
  message,
  enterScore,
  onPress,
  hint,
  timeLink,
  footer,
  pastDue = false,
}: {
  /** "Today", "Saturday, Oct 17", or "No time set yet". */
  dateLabel: string;
  /** The big serif line: "5:30 PM", or "By Sun, Nov 9" when no time is set. */
  time: string;
  myName: string;
  /** Photos as the API stores them ("/objects/..."); `Avatar` builds the address. */
  myPhoto?: string | null;
  /** The singles opponent's photo; initials in doubles or when they have none. */
  opponentPhoto?: string | null;
  /** "Mike Okafor", or "Okafor & Lindqvist" in doubles. */
  opponentName: string;
  /** Doubles (D8): your partner and the other team, for "You and Sam vs. Jo and Lee". */
  partnerName?: string | null;
  opponentNames?: string[];
  /** Court, e.g. "Beacon Courts · Court 3". */
  location?: string | null;
  /** League name, shown as the outline pill. */
  league: string;
  /** A quiet line under the pill, e.g. the grace-week rule. */
  note?: string | null;
  /** Match day, singles: Record with Ball Boi, the one primary button. */
  record?: NextMatchAction | null;
  message?: NextMatchAction | null;
  /** Enter score: beside Message, or leading it once past due. */
  enterScore?: NextMatchAction | null;
  /** Tapping the card (Home): opens Match detail. Left off on Match detail itself. */
  onPress?: (() => void) | null;
  /** VoiceOver hint for the tappable card; "Opens match details" by default. */
  hint?: string;
  /** Match detail: "Set a match time" or "Change time", link text under the date line. */
  timeLink?: { hasTime: boolean; onPress: () => void } | null;
  /** Under the buttons, e.g. the doubles Ball Boi note. */
  footer?: React.ReactNode;
  /** An hour past the start with no score (finding 47): Enter score leads, Record becomes a link. */
  pastDue?: boolean;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const face = Math.round(52 * Math.min(fontScale, 1.3));
  const stacked = fontScale >= 1.3;
  const doubles = !!partnerName && !!opponentNames?.length;
  const whenSummary = [dateLabel, time].join(". ");
  const restSummary = [doubles ? versusSpoken(partnerName, opponentNames!) : `You versus ${opponentName}`, location, league, note]
    .filter(Boolean)
    .join(". ");
  const summary = `${whenSummary}. ${restSummary}`;
  // The tappable card reads as one button: "Today, 6:30 PM, You vs. Elena Ortiz, Memorial Park, Beacon, Test League 1".
  const tappable = !!onPress && !timeLink;
  const cardSpoken = matchCardSpoken({
    dateLabel,
    time,
    versus: doubles ? `You and ${partnerName} vs. ${andJoin(opponentNames!)}` : `You vs. ${opponentName}`,
    location,
    league,
    note,
  });

  return (
    <Pressable
      // VoiceOver doesn't see this outer press (the info block below is the
      // button), so the buttons inside stay their own elements. A tap on a
      // button is caught by that button and doesn't open the card.
      accessible={false}
      disabled={!tappable}
      onPress={tappable ? onPress! : undefined}
      style={({ pressed }) => ({
        backgroundColor: c.linen,
        borderRadius: radius.radiusCard,
        // The hero card keeps more padding (design system), equal on every side (decision 192).
        padding: spacing.space6,
        alignItems: "center",
        // One rule for every card (John, Nov 7): the light hairline border, no shadow.
        borderWidth: 1,
        borderColor: c.hairline,
        opacity: tappable && pressed ? 0.85 : 1,
      })}
    >
      {/* With the time link, VoiceOver reads the date, then the link, then the rest. */}
      <View
        accessible={!timeLink}
        accessibilityRole={tappable ? "button" : undefined}
        accessibilityLabel={tappable ? cardSpoken : summary}
        accessibilityHint={tappable ? (hint ?? MATCH_CARD_HINT) : undefined}
        onAccessibilityTap={tappable ? onPress! : undefined}
        style={{ alignItems: "center", width: "100%" }}
      >
        <View accessible={!!timeLink} accessibilityLabel={whenSummary} style={{ alignItems: "center", width: "100%" }}>
          <Text variant="bodyStrong" tone="inkMuted" style={{ fontSize: 15, lineHeight: 20, textAlign: "center" }}>
            {dateLabel}
          </Text>
          <Text variant="displayL" style={{ marginTop: spacing.space1, marginBottom: timeLink ? 0 : spacing.space4, textAlign: "center", fontVariant: ["lining-nums", "tabular-nums"] }}>
            {time}
          </Text>
        </View>
        {timeLink ? (
          <MatchTimeLink hasTime={timeLink.hasTime} opponent={opponentName} onPress={timeLink.onPress} style={{ marginTop: spacing.space2, marginBottom: spacing.space4 }} />
        ) : null}
        <View accessible={!!timeLink} accessibilityLabel={restSummary} style={{ alignItems: "center", width: "100%" }}>
          <View style={{ flexDirection: "row" }}>
            <View style={{ borderRadius: radius.radiusPill, borderWidth: 2, borderColor: c.linen }}>
              <Avatar name={myName} uri={myPhoto} size={face} />
            </View>
            <View style={{ marginLeft: -10, borderRadius: radius.radiusPill, borderWidth: 2, borderColor: c.linen }}>
              <Avatar name={opponentName} uri={opponentPhoto} size={face} />
            </View>
          </View>
          <Text variant="bodyStrong" style={{ marginTop: 10, marginBottom: spacing.space1, textAlign: "center" }}>
            {doubles ? (
              <>
                {`You and ${firstName(partnerName)} `}
                <Text tone="inkMuted">vs.</Text> {andJoin(opponentNames!.map(firstName))}
              </>
            ) : (
              <>
                You <Text tone="inkMuted">vs.</Text> {opponentName}
              </>
            )}
          </Text>
          {location ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: spacing.space2, maxWidth: "100%" }}>
              <Icon name="mappin.and.ellipse" size={20} tintColor={c.inkMuted} style={{ marginTop: 1 }} />
              <Text style={{ flexShrink: 1, textAlign: stacked ? "left" : "center" }}>{location}</Text>
            </View>
          ) : null}
          <Pill label={league} style={{ alignSelf: "center", marginTop: spacing.space3 }} />
          {note ? (
            <Text variant="small" tone="inkMuted" style={{ marginTop: spacing.space2, textAlign: "center" }}>
              {note}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ width: "100%", marginTop: 20 }}>
        <MatchActions record={record} message={message} enterScore={enterScore} pastDue={pastDue} />
      </View>
      {footer ? <View style={{ width: "100%", marginTop: spacing.space3 }}>{footer}</View> : null}
    </Pressable>
  );
}
