import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MIN_TAP, radius, space, typography, useTheme } from "@/theme";

type Variant = keyof typeof typography;

export function Text({
  variant = "body",
  muted,
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const { c } = useTheme();
  // Dynamic Type stays on: allowFontScaling defaults to true. Cap only the
  // largest accessibility sizes for dense numeric labels via maxFontSizeMultiplier.
  return (
    <RNText
      maxFontSizeMultiplier={variant === "label" || variant === "stat" ? 2 : undefined}
      style={[typography[variant], { color: color ?? (muted ? c.textMuted : c.text) }, style]}
      {...rest}
    />
  );
}

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const { c } = useTheme();
  const body = <View style={[{ padding: space.lg, gap: space.lg }, style]}>{children}</View>;
  return (
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      {scroll ? <ScrollView contentInsetAdjustmentBehavior="automatic">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: space.lg, gap: space.sm },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type ButtonTone = "primary" | "secondary" | "destructive" | "apple";

export function Button({
  label,
  tone = "primary",
  loading,
  icon,
  accessibilityHint,
  style,
  ...rest
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  tone?: ButtonTone;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
}) {
  const { c, scheme } = useTheme();
  const palette: Record<ButtonTone, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    destructive: { bg: c.destructive, fg: c.onDestructive },
    // Apple HIG: black button in light mode, white in dark mode
    apple: scheme === "dark" ? { bg: "#FFFFFF", fg: "#000000" } : { bg: "#000000", fg: "#FFFFFF" },
  };
  const p = palette[tone];
  const disabled = rest.disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      hitSlop={4}
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        {
          minHeight: MIN_TAP,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.md,
          backgroundColor: p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : icon}
      <Text variant="headline" color={p.fg}>
        {label}
      </Text>
    </Pressable>
  );
}

export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <View accessible accessibilityLabel={`${label}: ${value}`}>
        <Text variant="label" muted>
          {label.toUpperCase()}
        </Text>
        <Text variant="stat">{value}</Text>
      </View>
    </Card>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View accessible accessibilityLabel={label} style={{ padding: space.xxl, alignItems: "center" }}>
      <ActivityIndicator color={c.primary} />
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: "flex-start" }}>
      <Text variant="headline">{title}</Text>
      <Text muted>{body}</Text>
      {action}
    </Card>
  );
}
