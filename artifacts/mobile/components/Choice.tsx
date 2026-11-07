import { Icon, type IconName } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
  /** What VoiceOver reads, when the label is short ("Tue" reads "Tuesday"). */
  accessibilityLabel?: string;
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
              accessibilityLabel={o.accessibilityLabel ?? o.label}
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
              {on ? <Icon name="checkmark" size={12} tintColor={c.onInk} /> : null}
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

/**
 * A 44pt round button with a brush icon, for in-page headers (TabHeader) and
 * in-page rows. In the native navigation bar use HeaderIconButton instead.
 */
export function IconButton({
  symbol,
  label,
  hint,
  onPress,
}: {
  symbol: IconName;
  label: string;
  /** What happens on tap, read by VoiceOver after the label. */
  hint?: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
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
      <Icon name={symbol} size={18} tintColor={c.ink} />
    </Pressable>
  );
}

/**
 * A plain brush icon button for the native navigation bar (headerRight and
 * headerLeft). It draws no circle, fill or border of its own: on iOS 26 the
 * system draws the Liquid Glass circle, so ours would show as a second one.
 * The hit area is still at least 44x44pt.
 */
export function HeaderIconButton({
  symbol,
  label,
  hint,
  onPress,
}: {
  symbol: IconName;
  label: string;
  /** What happens on tap, read by VoiceOver after the label. */
  hint?: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: MIN_TAP,
        minHeight: MIN_TAP,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={symbol} size={20} tintColor={c.ink} />
    </Pressable>
  );
}
