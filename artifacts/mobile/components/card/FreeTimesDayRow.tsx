// One day's row in When you can play (decision 156): the day's name as a
// header, the Morning, Afternoon and Evening pills, its custom times as their
// own pills, and Custom, which opens a text field on the row. Pills wrap onto
// more lines at the largest text sizes; nothing clips.

import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, TextInput, View, findNodeHandle, useWindowDimensions } from "react-native";

import { Icon } from "@/components/Icon";
import { Button, Field, Text, TextButton } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  BLOCKS,
  CUSTOM_HINT,
  DAY_NAMES,
  blockHours,
  blockSpoken,
  customSpoken,
  dayTimes,
  rangeText,
  type CustomField,
  type FreeRange,
} from "@/lib/freeTimes";

export function DayRow({
  day,
  ranges,
  field,
  problems,
  last,
  onToggle,
  onCustom,
  onCustomPill,
  onType,
  onAdd,
  onLeave,
  onCancel,
}: {
  day: number;
  ranges: FreeRange[];
  field: CustomField | null;
  problems: string[];
  last: boolean;
  onToggle: (b: (typeof BLOCKS)[number]) => void;
  onCustom: () => void;
  onCustomPill: (r: FreeRange) => void;
  onType: (t: string) => void;
  onAdd: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { on, custom } = dayTimes(ranges, day);
  const name = DAY_NAMES[day];
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  // A field opened from Custom or Edit takes focus; VoiceOver moves to it too.
  useEffect(() => {
    if (!field) return;
    const t = setTimeout(() => {
      input.current?.focus();
      try {
        const node = input.current ? findNodeHandle(input.current) : null;
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      } catch {
        // VoiceOver focus is a nicety; the keyboard focus above already moved.
      }
    }, 50);
    return () => clearTimeout(t);
  }, [field !== null, field?.editing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      style={{
        paddingVertical: spacing.space4,
        gap: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text variant="bodyStrong" accessibilityRole="header">
        {name}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }}>
        {BLOCKS.map((b) => (
          <TimePill
            key={b.key}
            label={b.name}
            detail={blockHours(b)}
            selected={on[b.key]}
            onPress={() => onToggle(b)}
            accessibilityLabel={blockSpoken(b, day)}
          />
        ))}
        {custom.map((r) => (
          <TimePill
            key={`${r.start}-${r.end}`}
            label={rangeText(r)}
            selected
            onPress={() => onCustomPill(r)}
            accessibilityLabel={customSpoken(r)}
            accessibilityHint="Edit or remove this time"
          />
        ))}
        {field ? null : (
          <TimePill
            label="Custom"
            symbol
            selected={false}
            onPress={onCustom}
            accessibilityLabel={`Custom times, ${name}`}
            accessibilityHint="Opens a field to type times, like 6 to 8 PM"
            toggle={false}
          />
        )}
      </View>

      {field ? (
        <View style={{ gap: spacing.space2 }}>
          <Field
            ref={input}
            label={field.editing ? `Edit ${rangeText(field.editing)}` : `Custom times, ${name}`}
            value={field.text}
            onChangeText={onType}
            onBlur={onLeave}
            onSubmitEditing={onAdd}
            returnKeyType="done"
            autoCorrect={false}
            autoCapitalize="none"
            placeholder="6 to 8 PM, 9 to 10 PM"
            hint={problems.length ? problems.join("\n") : CUSTOM_HINT}
            error={problems.length > 0}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
            <Button
              label={field.editing ? "Done" : "Add"}
              variant="secondary"
              onPress={onAdd}
              accessibilityLabel={field.editing ? `Done editing ${name}'s time` : `Add times to ${name}`}
              style={{ paddingHorizontal: spacing.space6 }}
            />
            <TextButton label="Cancel" accessibilityLabel={`Cancel, keep ${name} as it was`} onPress={onCancel} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A 44pt time pill. Selected: filled ink, on-ink text, no check (Nov 7 chip
 * rule), read as "selected". Custom is a plain button with the brush plus.
 * It shrinks to the row and wraps its words at the largest text sizes.
 */
export function TimePill({
  label,
  detail,
  selected,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  symbol = false,
  toggle = true,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  symbol?: boolean;
  toggle?: boolean;
}) {
  const c = useColors();
  // The brush plus grows with the text, so it doesn't shrink beside large words.
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={toggle ? { selected } : undefined}
      hitSlop={2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        maxWidth: "100%",
        flexShrink: 1,
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
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {symbol ? <Icon name="plus" size={Math.round(15 * Math.min(Math.max(fontScale, 1), 2.5))} tintColor={selected ? c.onInk : c.ink} /> : null}
      <Text variant="bodyStrong" tone={selected ? "onInk" : "ink"} style={{ flexShrink: 1, textAlign: "center" }}>
        {label}
        {detail ? (
          <Text variant="body" tone={selected ? "onInk" : "inkMuted"}>
            {` ${detail}`}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}
