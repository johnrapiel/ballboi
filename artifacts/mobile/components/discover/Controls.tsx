// Discover's controls, built from the design system tokens to match the
// "Wave 2 designs" canvas: chips with no check (Nov 7 chip rule), the
// Players / Open leagues / Open matches segmented control, the area row and
// the distance chips with counts.

import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { RADIUS_STEPS, areaLine, countFor, isCustomRadius, radiusChipSpoken, type DiscoverArea, type DiscoverTab } from "@/lib/discover";

/** Text sizes at which rows of controls stack instead of sitting side by side. */
export function useLargeText(threshold = 1.35): boolean {
  return useWindowDimensions().fontScale >= threshold;
}

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** What VoiceOver reads, when the label needs more ("10 miles, 14 players"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  /** A muted part after the label, like the count in "10 mi · 14". */
  detail?: string;
  symbol?: SFSymbol;
}

/**
 * A 44pt choice chip. Selected is a filled ink pill with on-ink text and no
 * check (Nov 7 chip rule); unselected has a hairline-strong outline (3:1).
 * VoiceOver reads it as a button with "selected".
 */
export function ChoiceChip({ label, selected, onPress, accessibilityLabel, accessibilityHint, disabled, detail, symbol }: ChipProps) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled: !!disabled }}
      hitSlop={2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: selected ? c.ink : c.hairlineStrong,
        backgroundColor: selected ? c.ink : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.space1,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {symbol ? <SymbolView name={symbol} size={15} tintColor={selected ? c.onInk : c.ink} /> : null}
      <Text variant="bodyStrong" tone={selected ? "onInk" : "ink"} style={{ textAlign: "center" }}>
        {label}
        {detail ? (
          <Text variant="body" tone={selected ? "onInk" : "inkMuted"}>
            {` · ${detail}`}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ label, children, style }: { label?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityLabel={label} style={[{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }, style]}>
      {children}
    </View>
  );
}

const TABS: { value: DiscoverTab; label: string }[] = [
  { value: "players", label: "Players" },
  { value: "leagues", label: "Open leagues" },
  { value: "matches", label: "Open matches" },
];

/**
 * Players / Open leagues / Open matches, drawn like the iOS segmented
 * control: a sand track with the selected segment raised in linen. Text
 * scales with Dynamic Type; at the largest sizes the segments stack into
 * full-width rows instead of truncating (review finding 3).
 */
export function DiscoverTabs({ value, onChange }: { value: DiscoverTab; onChange: (t: DiscoverTab) => void }) {
  const c = useColors();
  const stacked = useLargeText();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Show"
      style={{
        flexDirection: stacked ? "column" : "row",
        backgroundColor: c.sand,
        borderRadius: radius.radiusMd,
        borderWidth: 1,
        borderColor: c.hairline,
        padding: 2,
        gap: 2,
      }}
    >
      {TABS.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flex: stacked ? undefined : 1,
              minHeight: MIN_TAP - 4,
              paddingHorizontal: spacing.space2,
              paddingVertical: spacing.space1,
              borderRadius: radius.radiusMd - 2,
              alignItems: stacked ? "flex-start" : "center",
              justifyContent: "center",
              backgroundColor: on ? c.linen : "transparent",
              borderWidth: on ? 1 : 0,
              borderColor: c.hairline,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              variant="segment"
              tone="ink"
              style={{ textAlign: stacked ? "left" : "center", fontFamily: on ? "DMSans_600SemiBold" : undefined }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Near 12590, Wappingers Falls · Change", one 44pt button. */
export function AreaRow({ area, onPress }: { area: DiscoverArea | null; onPress: () => void }) {
  const c = useColors();
  const stacked = useLargeText();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={area ? `Your area, ${area.zip}, ${area.town}. Change` : "Add your ZIP"}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        gap: stacked ? spacing.space1 : spacing.space2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, flexShrink: 1, flexGrow: 1 }}>
        <SymbolView name="mappin.and.ellipse" size={18} tintColor={c.ink} />
        <Text style={{ flexShrink: 1 }}>{areaLine(area)}</Text>
      </View>
      <Text style={{ textDecorationLine: "underline" }}>{area ? "Change" : "Add"}</Text>
    </Pressable>
  );
}

/**
 * 5 / 10 / 15 / 30 mi and Custom, each with its count ("10 mi · 14"), read
 * as "10 miles, 14 players, selected" (review finding 5). One distance for
 * all three tabs.
 */
export function DistanceChips({
  radius: selected,
  counts,
  noun,
  onPick,
  onCustom,
}: {
  radius: number;
  counts: { radius: number; count: number }[];
  /** "players", "open leagues", "open matches". */
  noun: string;
  onPick: (r: number) => void;
  onCustom: () => void;
}) {
  const custom = isCustomRadius(selected);
  const customCount = custom ? countFor(counts, selected) : null;
  return (
    <ChipRow label="Distance">
      {RADIUS_STEPS.map((r) => {
        const n = countFor(counts, r);
        const on = r === selected;
        return (
          <ChoiceChip
            key={r}
            label={`${r} mi`}
            detail={n == null ? undefined : String(n)}
            selected={on}
            onPress={() => onPick(r)}
            accessibilityLabel={radiusChipSpoken(r, n, false, noun)}
          />
        );
      })}
      <ChoiceChip
        label={custom ? `${selected} mi` : "Custom"}
        detail={custom && customCount != null ? String(customCount) : undefined}
        selected={custom}
        onPress={onCustom}
        accessibilityLabel={custom ? `Custom distance, ${radiusChipSpoken(selected, customCount, false, noun)}` : "Custom distance"}
        accessibilityHint="Pick any distance from 1 to 30 miles"
      />
    </ChipRow>
  );
}

/** An underlined text button with a 44pt target, for "Set times", "Change in Settings". */
export function LinkButton({
  label,
  onPress,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={4}
      style={({ pressed }) => [
        { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Text variant="bodyStrong" style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The Filters button beside the count line: an outlined 44pt pill. */
export function FiltersButton({
  onPress,
  accessibilityLabel,
  active,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        paddingHorizontal: spacing.space4,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name="line.3.horizontal.decrease" size={15} tintColor={c.ink} />
      <Text variant="bodyStrong">{active ? "Filters on" : "Filters"}</Text>
    </Pressable>
  );
}
