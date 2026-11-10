// Conditions at stop (shot tracker test plan section 3) on the score prompt:
// Indoor / Outdoor, Day / Night, and surface. Optional and skippable; it
// never blocks saving the score. Chips follow the Wave 2 rule: selected is
// filled ink with no check, and VoiceOver reads "selected". Tapping a
// selected chip clears it. At large text sizes the chips wrap.

import React from "react";
import { View } from "react-native";

import { ChipRow, ChoiceChip } from "@/components/discover/Controls";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { CONDITION_GROUPS, toggleCondition, type Conditions } from "@/lib/recording/conditions";

export function ConditionsRow({ value, onChange }: { value: Conditions; onChange: (next: Conditions) => void }) {
  return (
    <View style={{ gap: spacing.space3 }}>
      <View style={{ gap: spacing.space1 }}>
        <Text variant="section" tone="inkMuted" accessibilityRole="header">
          Conditions
        </Text>
        <Text variant="small" tone="inkMuted">
          Optional. Helps Ball Boi learn how the court looked.
        </Text>
      </View>
      {CONDITION_GROUPS.map((group) => (
        <View key={group.key} style={{ gap: spacing.space2 }}>
          <Text variant="small" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
            {group.label}
          </Text>
          <ChipRow label={group.label}>
            {group.options.map((o) => (
              <ChoiceChip
                key={o.value}
                label={o.label}
                accessibilityLabel={`${o.label}, ${group.label.toLowerCase()}`}
                accessibilityHint={value[group.key] === o.value ? "Double-tap to clear." : undefined}
                selected={value[group.key] === o.value}
                onPress={() => onChange(toggleCondition(value, group.key, o.value))}
              />
            ))}
          </ChipRow>
        </View>
      ))}
    </View>
  );
}
