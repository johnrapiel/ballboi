import React from "react";
import { Pressable, View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// A plain centred card on Home for things that aren't a match to play: a bye
// week and an admin's pairings to review. Every match uses the approved D2
// card instead (NextMatchCard, design audit, Nov 7).
// The card's text reads as one VoiceOver element; its buttons follow it.

export interface MatchCardAction {
  label: string;
  onPress: () => void;
  hint?: string;
}

export function MatchCard({
  eyebrow,
  title,
  detail,
  note,
  primary,
  secondary,
  onOpen,
  openHint,
  footer,
}: {
  /** League and round, e.g. "Tuesday Flex · Round 3". */
  eyebrow: string;
  /** "You vs. Alex Kim" or "You have a bye this week". */
  title: string;
  /** When to play, e.g. "Play by Wed, Nov 25". */
  detail?: string | null;
  /** A second line, e.g. the grace-week rule. */
  note?: string | null;
  primary?: MatchCardAction | null;
  secondary?: MatchCardAction | null;
  /** Opens the match's league. */
  onOpen?: () => void;
  openHint?: string;
  /** Shown under the buttons, e.g. the doubles "Record with Ball Boi" state. */
  footer?: React.ReactNode;
}) {
  const summary = [eyebrow, title, detail, note].filter(Boolean).join(". ");
  const body = (
    <View style={{ gap: spacing.space1, alignItems: "center" }}>
      <Text variant="section" tone="inkMuted" style={{ textAlign: "center" }}>
        {eyebrow}
      </Text>
      <Text variant="title" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {detail ? <Text style={{ textAlign: "center" }}>{detail}</Text> : null}
      {note ? (
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
  return (
    // Sits in Home's match slot, so it keeps the Next match card's padding, equal on every side (decision 192).
    <Card style={{ gap: spacing.space4, padding: spacing.space6 }}>
      {onOpen ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={summary}
          accessibilityHint={openHint ?? "Opens the league"}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={summary}>
          {body}
        </View>
      )}
      {primary || secondary ? (
        <View style={{ gap: spacing.space2 }}>
          {primary ? <Button label={primary.label} onPress={primary.onPress} accessibilityHint={primary.hint} /> : null}
          {secondary ? (
            <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} accessibilityHint={secondary.hint} />
          ) : null}
        </View>
      ) : null}
      {footer}
    </Card>
  );
}
