// A destructive action that shouldn't be the loudest thing on a card: red
// text, no fill, like iOS's own destructive text buttons. Same 44pt target,
// roles and states as the shared Button. `danger` on `linen` is a checked
// text pair in both themes (scripts/check-contrast.mjs).

import React from "react";
import { ActivityIndicator, Pressable, type PressableProps } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export interface DestructiveTextButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  loading?: boolean;
  accessibilityLabel?: string;
}

export function DestructiveTextButton({
  label,
  loading = false,
  disabled,
  accessibilityLabel,
  ...rest
}: DestructiveTextButtonProps) {
  const c = useColors();
  const inactive = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space4,
        alignItems: "center",
        justifyContent: "center",
        opacity: inactive ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={c.danger} />
      ) : (
        <Text variant="button" tone="danger">
          {label}
        </Text>
      )}
    </Pressable>
  );
}
