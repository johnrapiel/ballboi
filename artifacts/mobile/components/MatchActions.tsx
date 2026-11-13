import React from "react";
import { View } from "react-native";

import { Button, ButtonRow, TextLinkButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { matchActionLayout, type MatchActionKey } from "@/lib/matchActions";

// The one set of actions on a match card before it's played (Wave 2 finding
// 54, decision 199): Record with Ball Boi, then Message and Enter score; past
// due, Enter score leads and Record is a link (finding 47). Home's next
// match, the league page's Your match and Match detail all draw their
// buttons with this, so they can't drift apart again. The order and which
// button is primary live in lib/matchActions.ts.

export interface MatchAction {
  label: string;
  onPress: () => void;
  /** Spoken by VoiceOver in place of the label, e.g. "Message Mike Okafor". */
  accessibilityLabel?: string;
  hint?: string;
  loading?: boolean;
}

export function MatchActions({
  record,
  message,
  enterScore,
  pastDue = false,
  recordPlaceholder,
}: {
  record?: MatchAction | null;
  message?: MatchAction | null;
  enterScore?: MatchAction | null;
  pastDue?: boolean;
  /** Doubles on the league page: Record dimmed with its reason, in Record's place. Not shown past due. */
  recordPlaceholder?: React.ReactNode;
}) {
  const placeholder = !pastDue && !record && !!recordPlaceholder;
  const slots = matchActionLayout({ record: !!record, message: !!message, enterScore: !!enterScore, pastDue, recordPlaceholder: placeholder });
  if (slots.length === 0 && !placeholder) return null;
  const actionFor = (key: MatchActionKey): MatchAction => (key === "record" ? record! : key === "message" ? message! : enterScore!);
  const button = (key: MatchActionKey, variant: "primary" | "secondary") => {
    const a = actionFor(key);
    return (
      <Button
        key={key}
        label={a.label}
        accessibilityLabel={a.accessibilityLabel}
        accessibilityHint={a.hint}
        variant={variant}
        loading={a.loading}
        onPress={a.onPress}
      />
    );
  };
  const lead = slots.filter((s) => s.place === "lead");
  const row = slots.filter((s) => s.place === "row");
  const under = slots.filter((s) => s.place === "under");

  return (
    <View style={{ width: "100%", gap: spacing.space2 }}>
      {placeholder ? recordPlaceholder : null}
      {lead.map((s) => button(s.key, s.variant))}
      {row.length ? <ButtonRow>{row.map((s) => button(s.key, s.variant))}</ButtonRow> : null}
      {under.map((s) => {
        const a = actionFor(s.key);
        return <TextLinkButton key={s.key} label={a.label} accessibilityLabel={a.accessibilityLabel} accessibilityHint={a.hint} onPress={a.onPress} />;
      })}
    </View>
  );
}
