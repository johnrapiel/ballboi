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
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextProps as RNTextProps,
  type ViewStyle,
  type ViewProps,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { useAccessibilitySettings } from "@/hooks/useAccessibilitySettings";
import { BUTTON_PAD_X, buttonHeight, shouldStackButtons } from "@/lib/buttonSize";
import { useColors, useScheme } from "@/hooks/useColors";
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
import { textTapSlop } from "@/lib/tapTarget";

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
  const scheme = useScheme();
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
/**
 * Page and sheet titles (`headingL`, `headingM`) sit in ink at 50%, like a
 * watermark on the page (John, Nov 7). Increase Contrast shows them at full ink.
 */
const WATERMARK: readonly TypeStyle[] = ["headingL", "headingM"];

export function Text({ variant = "body", tone = "ink", style, ...rest }: TextProps) {
  const c = useColors();
  const t = useTypeStyle(variant);
  const { increaseContrast } = useAccessibilitySettings();
  const watermark = WATERMARK.includes(variant) && !increaseContrast ? { opacity: 0.5 } : null;
  return (
    <RNText
      maxFontSizeMultiplier={t.maxFontSizeMultiplier}
      {...rest}
      style={[t.style, { color: c[tone] }, watermark, style]}
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

/**
 * A tertiary action on its own line: a centered TextLink padded to a 44pt
 * tap area. Used under a primary and a secondary Button when a card,
 * screen or empty state has more to offer (decision 189: at most one
 * primary and one secondary Button; anything else is one of these).
 */
export function TextLinkButton({
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({
        alignSelf: "center",
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space4,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <TextLink variant="bodyStrong" onPress={onPress} accessible={false} style={{ textAlign: "center" }}>
        {label}
      </TextLink>
    </Pressable>
  );
}

export interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  /**
   * primary: ink pill. secondary: outlined pill. destructive: danger pill.
   * destructiveOutline: danger outline pill, for a quieter red action (Sign out).
   */
  variant?: "primary" | "secondary" | "destructive" | "destructiveOutline";
  loading?: boolean;
  /** Spoken by VoiceOver. Defaults to `label`. */
  accessibilityLabel?: string;
}

/**
 * The one button height (John, Nov 10): 48pt at the default text size,
 * growing only with Dynamic Type. Hand-built buttons that can't be a Button
 * (the camera's ChromeButton) use this too.
 */
export function useButtonHeight(): number {
  const { fontScale } = useWindowDimensions();
  return buttonHeight(fontScale);
}

/**
 * Pill button. Every Button is one height (John, Nov 10): 48pt at the
 * default text size, growing only with Dynamic Type, so side-by-side buttons
 * always match. The label stays on one line. Put two or more side by side in
 * a ButtonRow, which stacks them when a label wouldn't fit.
 */
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
  const height = useButtonHeight();
  const fill = variant === "primary" ? c.ink : variant === "destructive" ? c.danger : "transparent";
  const textColor = variant === "secondary" ? c.ink : variant === "destructiveOutline" ? c.danger : c.onInk;
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
          height,
          minWidth: MIN_TAP,
          paddingHorizontal: BUTTON_PAD_X,
          borderRadius: radius.radiusPill,
          backgroundColor: fill,
          borderWidth: variant === "secondary" || variant === "destructiveOutline" ? 1 : 0,
          borderColor: variant === "destructiveOutline" ? c.danger : c.hairlineStrong,
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
        // One line, always. A ButtonRow stacks before a label runs out of
        // room; a lone full-width label too long for the largest text size
        // shrinks a little to fit rather than being cut off.
        <Text variant="button" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: textColor }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export interface ButtonRowProps extends ViewProps {
  children: React.ReactNode;
}

/**
 * Buttons side by side, sharing the row equally and one height. When any
 * label wouldn't fit its share on one line, as at the largest text sizes,
 * the row stacks its buttons full width instead of wrapping a label.
 * Children are Buttons; their `label` decides the fit.
 */
export function ButtonRow({ children, style, onLayout, ...rest }: ButtonRowProps) {
  const { fontScale, width: windowWidth } = useWindowDimensions();
  // Until the row is measured, guess a card inside the page gutters, so a row
  // that will stack at large text sizes starts stacked instead of jumping.
  const [width, setWidth] = React.useState(0);
  const rowWidth = width || Math.max(0, windowWidth - 4 * spacing.space4);
  const items = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<{ label?: unknown }>[];
  const labels = items.map((el) => (typeof el.props.label === "string" ? el.props.label : ""));
  const stack = shouldStackButtons(labels, rowWidth, fontScale, spacing.space2);
  return (
    <View
      {...rest}
      onLayout={(e: LayoutChangeEvent) => {
        setWidth(e.nativeEvent.layout.width);
        onLayout?.(e);
      }}
      style={[{ flexDirection: stack ? "column" : "row", gap: spacing.space2 }, style]}
    >
      {items.map((el, i) => (
        <View key={el.key ?? i} style={stack ? undefined : { flex: 1 }}>
          {el}
        </View>
      ))}
    </View>
  );
}

/** Raised surface: linen with a hairline border, never a drop shadow. Every card uses the 16pt card corner. */
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
          borderRadius: radius.radiusCard,
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
   * quiet: a plain status word ("Done", "Requested"), drawn as the outline
   * Pill in sentence case. live: filled court with a dot, the one thing
   * happening now. ink: filled ink, for You. Live and You keep the uppercase
   * chip type and their fill (John, Nov 5); a quiet tag never fills.
   */
  tone?: "quiet" | "live" | "ink";
}

/**
 * Small status tag. Plain tags are the outline Pill with no fill (John, Nov 5);
 * only You, Live and Rec stay filled, in uppercase chip type. Carries its
 * meaning in text and shape, never color alone.
 */
export function Chip({ label, tone = "quiet", style, ...rest }: ChipProps) {
  const c = useColors();
  if (tone === "quiet") return <Pill label={label} style={style} {...rest} />;
  const fill = tone === "live" ? c.court : c.ink;
  return (
    <View
      {...rest}
      accessible
      accessibilityLabel={label}
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: fill,
          borderColor: fill,
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
      <Text variant="chip" style={{ color: c.onInk }}>
        {label}
      </Text>
    </View>
  );
}

export interface PillProps extends ViewProps {
  label: string;
  /** Spoken by VoiceOver, when the visible word needs more (level: "Level 3.5"). */
  accessibilityLabel?: string;
  /** Muted text, for the quieter pill in a row (a rank beside level and hand). */
  quiet?: boolean;
}

/**
 * A plain pill: level, hand, format, rank. Sentence case, outline only, never
 * filled, and never tappable, so it stays distinct from 44pt chips and buttons.
 * Pills in one row share one height and type size (John, Nov 5).
 */
export function Pill({ label, accessibilityLabel, quiet = false, style, ...rest }: PillProps) {
  const c = useColors();
  return (
    <View
      {...rest}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        {
          alignSelf: "flex-start",
          minHeight: 26,
          justifyContent: "center",
          paddingHorizontal: 10,
          paddingVertical: spacing.space1,
          borderRadius: radius.radiusPill,
          borderWidth: 1,
          borderColor: c.hairlineStrong,
          backgroundColor: "transparent",
        },
        style,
      ]}
    >
      <Text variant="pill" tone={quiet ? "inkMuted" : "ink"} style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A match result in a condensed list: W in court green or L in danger red,
 * outlined, with no icon (John, Nov 5). The letter carries the meaning, so
 * color is never the only signal, and VoiceOver reads Won or Lost.
 */
export function ResultTag({ won, style, ...rest }: ViewProps & { won: boolean }) {
  const c = useColors();
  const tone = won ? c.court : c.danger;
  return (
    <View
      {...rest}
      accessible
      accessibilityRole="text"
      accessibilityLabel={won ? "Won" : "Lost"}
      style={[
        {
          alignSelf: "center",
          minWidth: 40,
          minHeight: 26,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 7,
          borderRadius: radius.radiusPill,
          borderWidth: 1,
          borderColor: tone,
        },
        style,
      ]}
    >
      <Text variant="pill" style={{ color: tone, fontFamily: "DMSans_700Bold" }}>
        {won ? "W" : "L"}
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
  /** "label" (11px caps, the default) or "bodyStrong" for sentence case labels inside a form card (New league, decision 182). */
  labelVariant?: "label" | "bodyStrong";
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
export function Field({ label, hint, error = false, labelVariant = "label", style, ...rest }: FieldProps) {
  const c = useColors();
  const body = useTypeStyle("body");
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant={labelVariant} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.inkMuted}
        keyboardAppearance={c.scheme}
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

export interface ScrollScreenProps extends Omit<ScrollViewProps, "style" | "contentContainerStyle"> {
  /** Laid out like Screen's style: a column that fills the screen. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Screen that scrolls when its content doesn't fit, as at the largest text
 * sizes (Wave 1 review A8: layouts reflow, nothing falls off-screen). At
 * normal sizes it looks like Screen: the content fills the page, so
 * `marginTop: "auto"` still puts buttons at the bottom and
 * `justifyContent: "center"` still centers.
 */
export function ScrollScreen({ style, children, ...rest }: ScrollScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      {...rest}
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={[
        {
          flexGrow: 1,
          paddingTop: insets.top + spacing.space4,
          paddingBottom: insets.bottom + spacing.space4,
          paddingHorizontal: spacing.space4,
        },
        style,
      ]}
    >
      {children}
    </ScrollView>
  );
}

export interface TextButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  /** Spoken by VoiceOver. Defaults to `label`. */
  accessibilityLabel?: string;
}

/**
 * A quiet text-only button, like iOS's plain button: muted body text with a
 * 44pt target. For secondary ways out (Sign out) that shouldn't compete with
 * the primary button. The target comes from hitSlop, not layout, so it adds no
 * visible space around the words (decision 192).
 */
export function TextButton({ label, accessibilityLabel, disabled, style, ...rest }: TextButtonProps) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={textTapSlop("body")}
      style={(state) => [
        {
          alignSelf: "center",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : state.pressed ? 0.6 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
    >
      <Text tone="inkMuted" style={{ textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
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

