// Discover's controls, built from the design system tokens to match the
// "Wave 2 designs" canvas: chips with no check (Nov 7 chip rule), the
// Players / Open leagues / Open matches segmented control, the area row and
// the distance chips with counts.

import { PlainIconButton } from "@/components/Choice";
import { Icon, type IconName } from "@/components/Icon";
import React from "react";
import { Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MAX_RADIUS, MIN_RADIUS, RADIUS_STEPS, areaLine, countFor, isCustomRadius, radiusChipSpoken, type DiscoverArea, type DiscoverTab } from "@/lib/discover";
import { textTapSlop } from "@/lib/tapTarget";

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
  symbol?: IconName;
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
      {symbol ? <Icon name={symbol} size={15} tintColor={selected ? c.onInk : c.ink} /> : null}
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

/**
 * "Near 12590, Wappingers Falls" with the town underlined: the line itself is
 * the link, no separate "Change" (John, Nov 5 and Nov 7). One 44pt button.
 * With no ZIP yet, the whole line is the link.
 */
export function AreaRow({ area, onPress }: { area: DiscoverArea | null; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={area ? `Your area, ${area.zip}, ${area.town}` : "Add your ZIP to find players near you"}
      accessibilityHint={area ? "Changes your area" : undefined}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        // Room above and below the line so it's never cut off, at any text size.
        paddingVertical: spacing.space1,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        alignSelf: "flex-start",
        maxWidth: "100%",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="mappin.and.ellipse" size={18} tintColor={c.ink} />
      {area ? (
        <Text style={{ flexShrink: 1 }}>
          {`Near ${area.zip}, `}
          <Text style={{ textDecorationLine: "underline" }}>{area.town}</Text>
        </Text>
      ) : (
        <Text style={{ flexShrink: 1, textDecorationLine: "underline" }}>{areaLine(area)}</Text>
      )}
    </Pressable>
  );
}

/**
 * 5 / 10 / 15 / 30 / 50 mi and Custom, each with its count ("10 mi · 14"), read
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
        accessibilityHint={`Pick any distance from ${MIN_RADIUS} to ${MAX_RADIUS} miles`}
      />
    </ChipRow>
  );
}

/**
 * An underlined text button for "Set times", "Change in Settings". Its 44pt
 * target comes from hitSlop, so it adds no space inside a card (decision 192).
 */
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
      hitSlop={textTapSlop("bodyStrong")}
      style={({ pressed }) => [
        { justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Text variant="bodyStrong" style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The Filters button beside the count line: the brush sliders icon alone,
 * plain in ink with no circle or border, a 44pt tap area (button standard,
 * John, Nov 8). VoiceOver reads "Filters" and what's set. A small ink dot
 * shows when filters are on.
 */
export function FiltersButton({
  onPress,
  accessibilityLabel,
  active,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
}) {
  return <PlainIconButton symbol="slider.horizontal.2" label={accessibilityLabel} onPress={onPress} active={active} />;
}
