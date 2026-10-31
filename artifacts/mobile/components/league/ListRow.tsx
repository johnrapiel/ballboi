import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * A row in a grouped list (Manage, pairing review). Tappable rows read as one
 * button to VoiceOver and are at least 52pt tall. `trailing` is visible text,
 * never color alone.
 */
export function ListRow({
  title,
  subtitle,
  trailing,
  symbol,
  onPress,
  accessibilityHint,
  last,
  destructive,
}: {
  title: string;
  subtitle?: string | null;
  trailing?: string | null;
  symbol?: SFSymbol;
  onPress?: () => void;
  accessibilityHint?: string;
  last?: boolean;
  destructive?: boolean;
}) {
  const c = useColors();
  const label = [title, subtitle, trailing].filter(Boolean).join(". ");
  const body = (
    <>
      {symbol ? <SymbolView name={symbol} size={18} tintColor={destructive ? c.danger : c.ink} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={destructive ? "danger" : "ink"}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text variant="label" tone="inkMuted">
          {trailing}
        </Text>
      ) : null}
      {onPress ? <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
    </>
  );
  const style = {
    minHeight: 52,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.space3,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space3,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: c.hairline,
  };
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Section heading above a grouped list. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
      {children}
    </Text>
  );
}
