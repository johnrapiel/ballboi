import { CornerButton } from "@/components/CornerButton";
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
 * onto a second line when they don't fit. The selected option is filled with
 * `ink` and `on-ink` text, no icon (John, Nov 7): filled against outlined is
 * a change of shape, not just color. VoiceOver reads "selected".
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
      {/* Section label: sentence case, like every group label in the design system. */}
      <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <View accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label}, ${o.accessibilityLabel ?? o.label}`}
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
 * A screen-corner button on a tab (button standard, John, Nov 8): the glass
 * circle, for the tab's own action beside Messages (Start a league on
 * Leagues, Settings on Profile). In the native navigation bar use
 * HeaderIconButton; inside the page use PlainIconButton.
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
  return <CornerButton symbol={symbol} label={label} hint={hint} onPress={onPress} />;
}

/**
 * An icon button inside the page (button standard, John, Nov 8): a plain
 * brush icon in ink with no circle or border, still a 44pt tap area. A small
 * ink dot shows when something is on (active filters); say so in the label
 * too. Used for Filters, the chat's Add a match and Send, and small edit
 * pencils. Anything that does the screen's job gets words (Button) instead.
 */
export function PlainIconButton({
  symbol,
  label,
  hint,
  onPress,
  active,
  disabled,
  size = 22,
}: {
  symbol: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  /** Shows the small ink dot. */
  active?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={symbol} size={size} tintColor={disabled ? c.inkMuted : c.ink} />
      {active ? (
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: c.ink,
            borderWidth: 2,
            borderColor: c.paper,
          }}
        />
      ) : null}
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
