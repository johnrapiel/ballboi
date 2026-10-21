import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * Pick one option from a short list, like a segmented control. Options wrap
 * onto a second line when they don't fit. The selected option is ink-filled
 * and checked, so it never relies on color alone. VoiceOver reads it as a
 * radio group.
 */
export function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** One line under the options explaining the current choice. */
  hint?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.label}
              style={({ pressed }) => ({
                minHeight: MIN_TAP,
                minWidth: MIN_TAP,
                paddingHorizontal: spacing.space4,
                borderRadius: radius.radiusPill,
                borderWidth: 1,
                borderColor: on ? c.ink : c.hairlineStrong,
                backgroundColor: on ? c.ink : "transparent",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.space1,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              {on ? <SymbolView name="checkmark" size={12} tintColor={c.onInk} /> : null}
              <Text variant="bodyStrong" tone={on ? "onInk" : "ink"}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? (
        <Text variant="small" tone="inkMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A 44pt round button with an SF Symbol, for a screen's main action in the header. */
export function IconButton({ symbol, label, onPress }: { symbol: SFSymbol; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name={symbol} size={18} tintColor={c.ink} />
    </Pressable>
  );
}
