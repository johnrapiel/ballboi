import React from "react";
import { useWindowDimensions, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Button, Pill, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Next match card D2 (approved design audit, Home, John, Nov 6): one plain
// card with the standard light hairline border (Nov 7) with no inner boxes, all centred in one flow. The date, a big
// serif time, both faces overlapped, "You vs. Mike", the court with a pin, the
// league as an outline pill, then the buttons.
//
// Buttons (audit, Home and Home match day):
// - Match day, singles: Record with Ball Boi on its own row, then Message and
//   Details side by side.
// - Any other match: Message (primary) and Details side by side.
// Enter score lives on Details (Match detail) and the league, not on this card.
//
// The audit overrides anything built that doesn't match it (John, Nov 7).

export interface NextMatchAction {
  label: string;
  onPress: () => void;
  /** Spoken by VoiceOver in place of the label, e.g. "Message Mike Okafor". */
  accessibilityLabel?: string;
  hint?: string;
}

export function NextMatchCard({
  dateLabel,
  time,
  myName,
  myPhoto,
  opponentName,
  location,
  league,
  note,
  record,
  message,
  details,
  footer,
}: {
  /** "Today", "Saturday, Oct 17", or "No time set yet". */
  dateLabel: string;
  /** The big serif line: "5:30 PM", or "By Sun, Nov 9" when no time is set. */
  time: string;
  myName: string;
  myPhoto?: string | null;
  /** "Mike Okafor", or "Okafor & Lindqvist" in doubles. */
  opponentName: string;
  /** Court, e.g. "Beacon Courts · Court 3". */
  location?: string | null;
  /** League name, shown as the outline pill. */
  league: string;
  /** A quiet line under the pill, e.g. the grace-week rule. */
  note?: string | null;
  /** Match day, singles: Record with Ball Boi, the one primary button. */
  record?: NextMatchAction | null;
  message?: NextMatchAction | null;
  /** Opens Match detail. Left off for a Discover match, whose Message opens the chat its card lives in. */
  details?: NextMatchAction | null;
  /** Under the buttons, e.g. the doubles Ball Boi note. */
  footer?: React.ReactNode;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const face = Math.round(52 * Math.min(fontScale, 1.3));
  const stacked = fontScale >= 1.3;
  const summary = [dateLabel, time, `You versus ${opponentName}`, location, league, note].filter(Boolean).join(". ");
  // Message is primary unless Record leads on match day.
  const messageVariant = record ? "secondary" : "primary";

  return (
    <View
      style={{
        backgroundColor: c.linen,
        borderRadius: radius.radiusCard,
        paddingTop: 22,
        paddingHorizontal: 20,
        paddingBottom: 20,
        alignItems: "center",
        // One rule for every card (John, Nov 7): the light hairline border, no shadow.
        borderWidth: 1,
        borderColor: c.hairline,
      }}
    >
      <View accessible accessibilityLabel={summary} style={{ alignItems: "center", width: "100%" }}>
        <Text variant="bodyStrong" tone="inkMuted" style={{ fontSize: 15, lineHeight: 20, textAlign: "center" }}>
          {dateLabel}
        </Text>
        <Text variant="displayL" style={{ marginTop: spacing.space1, marginBottom: spacing.space4, textAlign: "center", fontVariant: ["lining-nums", "tabular-nums"] }}>
          {time}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <View style={{ borderRadius: radius.radiusPill, borderWidth: 2, borderColor: c.linen }}>
            <Avatar name={myName} uri={myPhoto} size={face} />
          </View>
          <View style={{ marginLeft: -10, borderRadius: radius.radiusPill, borderWidth: 2, borderColor: c.linen }}>
            <Avatar name={opponentName} size={face} />
          </View>
        </View>
        <Text variant="bodyStrong" style={{ marginTop: 10, marginBottom: spacing.space1, textAlign: "center" }}>
          You{" "}
          <Text tone="inkMuted">vs.</Text> {opponentName}
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

      <View style={{ width: "100%", marginTop: 20, gap: 10 }}>
        {record ? <Button label={record.label} accessibilityLabel={record.accessibilityLabel} accessibilityHint={record.hint} onPress={record.onPress} /> : null}
        <View style={{ flexDirection: stacked ? "column" : "row", gap: 10 }}>
          {message ? (
            <Button
              label={message.label}
              accessibilityLabel={message.accessibilityLabel}
              accessibilityHint={message.hint}
              variant={messageVariant}
              onPress={message.onPress}
              style={stacked ? undefined : { flex: 1 }}
            />
          ) : null}
          {details ? (
            <Button
              label={details.label}
              accessibilityLabel={details.accessibilityLabel}
              accessibilityHint={details.hint}
              variant={message || record ? "secondary" : "primary"}
              onPress={details.onPress}
              style={stacked ? undefined : { flex: 1 }}
            />
          ) : null}
        </View>
      </View>
      {footer ? <View style={{ width: "100%", marginTop: spacing.space3 }}>{footer}</View> : null}
    </View>
  );
}
