import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Grouped settings rows, iOS style (approved canvas: Profile, Settings): a
// sentence case section label, then rows with the value on the right and a
// chevron. A tappable row reads as one button; the value is always text.

export function SettingsSection({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.space2 }}>
      {title ? (
        <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
          {title}
        </Text>
      ) : null}
      <Card style={{ padding: 0, overflow: "hidden" }}>{children}</Card>
      {footer ? (
        <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  title,
  value,
  subtitle,
  onPress,
  accessibilityHint,
  last,
  destructive,
  trailing,
}: {
  title: string;
  value?: string | null;
  subtitle?: string | null;
  onPress?: () => void;
  accessibilityHint?: string;
  last?: boolean;
  /** Red, for Delete account. Always confirmed by the screen it opens. */
  destructive?: boolean;
  /** A control on the right instead of a value, like a switch. */
  trailing?: React.ReactNode;
}) {
  const c = useColors();
  const style = {
    minHeight: 52,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    flexWrap: "wrap" as const,
    gap: spacing.space3,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space3,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: c.hairline,
  };
  const body = (
    <>
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
        <Text tone={destructive ? "danger" : "ink"}>{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text tone="inkMuted" style={{ flexShrink: 1 }}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress ? <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
    </>
  );
  if (!onPress) {
    return trailing ? (
      <View style={style}>{body}</View>
    ) : (
      <View accessible accessibilityLabel={[title, value, subtitle].filter(Boolean).join(", ")} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, value].filter(Boolean).join(", ")}
      accessibilityHint={accessibilityHint ?? subtitle ?? undefined}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}
