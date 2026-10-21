import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export interface EmptyStateProps {
  /** SF Symbol shown above the title. Decorative. */
  symbol: SFSymbol;
  title: string;
  message: string;
}

/** Centered icon, title, and one line about what shows up here. */
export function EmptyState({ symbol, title, message }: EmptyStateProps) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${message}`}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.space2,
        paddingHorizontal: spacing.space8,
        paddingBottom: spacing.space12,
      }}
    >
      <SymbolView name={symbol} size={40} tintColor={c.inkMuted} style={{ marginBottom: spacing.space2 }} />
      <Text variant="title" style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text tone="inkMuted" style={{ textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
