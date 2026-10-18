// Ball Boi core components, built only from design system tokens
// (constants/tokens.ts). Rebuilt screens should use these instead of
// styling raw React Native views.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  View,
  type PressableProps,
  type TextProps as RNTextProps,
  type ViewProps,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";

type TypeStyle = keyof typeof type;
type Tone = "ink" | "inkMuted" | "pool" | "clay" | "danger" | "onInk";

export interface TextProps extends RNTextProps {
  /** Design system text style. Defaults to `body`. */
  variant?: TypeStyle;
  /** Text color token. Defaults to `ink`. `sun` is never text. */
  tone?: Tone;
}

/** Text in a design system style. Dynamic Type stays on. */
export function Text({ variant = "body", tone = "ink", style, ...rest }: TextProps) {
  const c = useColors();
  return <RNText {...rest} style={[type[variant], { color: c[tone] }, style]} />;
}

export interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  /** primary: ink pill. secondary: outlined pill. destructive: danger pill. */
  variant?: "primary" | "secondary" | "destructive";
  loading?: boolean;
  /** Spoken by VoiceOver. Defaults to `label`. */
  accessibilityLabel?: string;
}

/** Pill button with a 44pt minimum target. */
export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled,
  accessibilityLabel,
  style,
  ...rest
}: ButtonProps) {
  const c = useColors();
  const fill = variant === "primary" ? c.ink : variant === "destructive" ? c.danger : "transparent";
  const textColor = variant === "secondary" ? c.ink : c.onInk;
  const inactive = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      style={(state) => [
        {
          minHeight: MIN_TAP,
          minWidth: MIN_TAP,
          paddingHorizontal: spacing.space6,
          paddingVertical: spacing.space3,
          borderRadius: radius.radiusPill,
          backgroundColor: fill,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor: c.hairlineStrong,
          alignItems: "center",
          justifyContent: "center",
          opacity: inactive ? 0.5 : state.pressed ? 0.85 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <RNText style={[type.button, { color: textColor }]}>{label}</RNText>
      )}
    </Pressable>
  );
}

/** Raised surface: linen with a hairline border, never a drop shadow. */
export function Card({ style, ...rest }: ViewProps) {
  const c = useColors();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: c.linen,
          borderColor: c.hairline,
          borderWidth: 1,
          borderRadius: radius.radiusMd,
          padding: spacing.space4,
        },
        style,
      ]}
    />
  );
}

export interface ChipProps extends ViewProps {
  label: string;
  /** quiet: sand chip. live: clay, for the one thing happening now. win: pool. */
  tone?: "quiet" | "live" | "win";
}

/** Small uppercase tag. Carries its meaning in text, never color alone. */
export function Chip({ label, tone = "quiet", style, ...rest }: ChipProps) {
  const c = useColors();
  const textColor = tone === "live" ? c.clay : tone === "win" ? c.pool : c.ink;
  return (
    <View
      {...rest}
      accessible
      accessibilityLabel={label}
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: tone === "quiet" ? c.sand : "transparent",
          borderColor: tone === "quiet" ? "transparent" : textColor,
          borderWidth: 1,
          borderRadius: radius.radiusPill,
          paddingHorizontal: spacing.space3,
          paddingVertical: spacing.space1,
        },
        style,
      ]}
    >
      <RNText style={[type.label, { color: textColor }]}>{label}</RNText>
    </View>
  );
}
