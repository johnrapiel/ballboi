import React from "react";
import { Pressable, View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// A league match on Home and elsewhere (spec: Navigation > Home; Ball Boi >
// Recording: "Record with Ball Boi" is the primary action on a singles match
// card on match day, and Enter score takes over once it's played).
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
}) {
  const summary = [eyebrow, title, detail, note].filter(Boolean).join(". ");
  const body = (
    <View style={{ gap: spacing.space1 }}>
      <Text variant="label" tone="inkMuted">
        {eyebrow}
      </Text>
      <Text variant="title">{title}</Text>
      {detail ? (
        <Text variant="small" tone="inkMuted">
          {detail}
        </Text>
      ) : null}
      {note ? (
        <Text variant="small" tone="inkMuted">
          {note}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Card style={{ gap: spacing.space3 }}>
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
    </Card>
  );
}
