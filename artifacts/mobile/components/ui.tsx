// Ball Boi core components, built only from design system tokens
// (constants/tokens.ts). Rebuilt screens should use these instead of
// styling raw React Native views.

import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  useColorScheme,
  type PressableProps,
  type TextProps as RNTextProps,
  type ViewProps,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { useAccessibilitySettings } from "@/hooks/useAccessibilitySettings";
import { useColors } from "@/hooks/useColors";
import {
  MIN_TAP,
  displayFaces,
  heavierFace,
  maxScale,
  radius,
  spacing,
  type,
  type TypeStyle,
} from "@/constants/tokens";

type Tone = "ink" | "inkMuted" | "court" | "danger" | "onInk";

export interface TextProps extends RNTextProps {
  /** Design system text style. Defaults to `body`. */
  variant?: TypeStyle;
  /** Text color token. Defaults to `ink`. `court` is the only accent. */
  tone?: Tone;
}

/**
 * The font face for a style after the user's settings: one step heavier with
 * iOS Bold Text, and Cormorant one step heavier on Night session, where its
 * hairline strokes thin out as light text on navy.
 */
export function useTypeStyle(variant: TypeStyle) {
  const scheme = useColorScheme();
  const { boldText } = useAccessibilitySettings();
  const base = type[variant];
  const isDisplay = displayFaces.includes(base.fontFamily);
  const heavier = boldText || (isDisplay && scheme === "dark");
  const fontFamily = heavier ? (heavierFace[base.fontFamily] ?? base.fontFamily) : base.fontFamily;
  return { style: { ...base, fontFamily }, maxFontSizeMultiplier: maxScale[variant] };
}

/**
 * Text in a design system style. Dynamic Type stays on: text styles scale
 * fully, display styles stop at 1.5x so heroes and scores never clip.
 */
export function Text({ variant = "body", tone = "ink", style, ...rest }: TextProps) {
  const c = useColors();
  const t = useTypeStyle(variant);
  return (
    <RNText
      maxFontSizeMultiplier={t.maxFontSizeMultiplier}
      {...rest}
      style={[t.style, { color: c[tone] }, style]}
    />
  );
}

export interface TextLinkProps extends Omit<TextProps, "tone"> {
  onPress: () => void;
}

/**
 * A link inside a sentence. Always underlined: `court` is only 2:1 against
 * ink text, so color alone can't mark it (WCAG 1.4.1). Nest it in a Text.
 */
export function TextLink({ style, ...rest }: TextLinkProps) {
  return (
    <Text
      accessibilityRole="link"
      suppressHighlighting={false}
      {...rest}
      tone="court"
      style={[{ textDecorationLine: "underline" }, style]}
    />
  );
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
        <Text variant="button" style={{ color: textColor }}>
          {label}
        </Text>
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
  /**
   * quiet: sand chip. live: filled court with a dot, the one thing happening
   * now. win: court outline with a check. Each has a shape cue, so live, wins
   * and errors never differ by color alone.
   */
  tone?: "quiet" | "live" | "win";
}

/** Small uppercase tag. Carries its meaning in text and shape, never color alone. */
export function Chip({ label, tone = "quiet", style, ...rest }: ChipProps) {
  const c = useColors();
  const textColor = tone === "live" ? c.onInk : tone === "win" ? c.court : c.ink;
  return (
    <View
      {...rest}
      accessible
      accessibilityLabel={label}
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: tone === "quiet" ? c.sand : tone === "live" ? c.court : "transparent",
          borderColor: tone === "quiet" ? "transparent" : c.court,
          borderWidth: 1,
          borderRadius: radius.radiusPill,
          paddingHorizontal: spacing.space3,
          paddingVertical: spacing.space1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.space1,
        },
        style,
      ]}
    >
      {tone === "live" ? (
        <View style={[styles.liveDot, { backgroundColor: c.onInk }]} importantForAccessibility="no" />
      ) : null}
      {tone === "win" ? <CheckGlyph color={c.court} /> : null}
      <Text variant="chip" style={{ color: textColor }}>
        {label}
      </Text>
    </View>
  );
}

export interface FieldProps extends React.ComponentProps<typeof TextInput> {
  /** Visible label, also read by VoiceOver. */
  label: string;
  /** Helper or error text under the field. */
  hint?: string;
  error?: boolean;
}

/** Check: the cue for wins and confirmations. Errors use a hollow cross. */
export function CheckGlyph({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M2 6.5 4.75 9 10 3" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Cross: the cue for errors and losses, always beside text. */
export function CrossGlyph({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M3 3 9 9M9 3 3 9" stroke={color} strokeWidth={1.75} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  liveDot: { width: 6, height: 6, borderRadius: 3 },
});

/** Labeled text input: linen well, hairline-strong border (3:1), 48pt tall. */
export function Field({ label, hint, error = false, style, ...rest }: FieldProps) {
  const c = useColors();
  const body = useTypeStyle("body");
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.inkMuted}
        style={[
          body.style,
          {
            minHeight: 48,
            paddingHorizontal: 14,
            borderRadius: radius.radiusSm,
            borderWidth: 1,
            borderColor: error ? c.danger : c.hairlineStrong,
            backgroundColor: c.linen,
            color: c.ink,
          },
          style,
        ]}
      />
      {hint ? (
        <Text variant="small" tone={error ? "danger" : "inkMuted"} accessibilityLiveRegion={error ? "polite" : "none"}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Page background (paper) with safe-area padding and the page gutter. */
export function Screen({ style, children, ...rest }: ViewProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      {...rest}
      style={[
        {
          flex: 1,
          backgroundColor: c.paper,
          paddingTop: insets.top + spacing.space4,
          paddingBottom: insets.bottom + spacing.space4,
          paddingHorizontal: spacing.space4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Wrap a Screen that has text fields. Lifts the content above the keyboard and
 * paints the space it adds in `paper`, so no white strip shows above the keys.
 */
export function KeyboardScreen({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

