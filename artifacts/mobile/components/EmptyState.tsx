import { Icon, type IconName } from "@/components/Icon";
import React from "react";
import { View } from "react-native";

import { Roundel } from "@/components/Roundel";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

export type EmptyStateProps = (
  | {
      /** Brush icon shown above the title. Decorative. */
      symbol: IconName;
      roundel?: never;
    }
  | {
      /**
       * The roundel in place of a symbol, for player-facing empty states on
       * the main tabs. Decorative. On Home only while it has nothing to show;
       * its header then has no roundel (finding 27, Nov 6).
       */
      roundel: true;
      symbol?: never;
    }
) & {
  title: string;
  message: string;
};

/** Centered icon, title, and one line about what shows up here. */
export function EmptyState({ symbol, roundel, title, message }: EmptyStateProps) {
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
      {roundel ? (
        <View style={{ marginBottom: spacing.space3 }} accessible={false}>
          <Roundel size={120} emptyState />
        </View>
      ) : (
        <Icon name={symbol} size={40} tintColor={c.inkMuted} style={{ marginBottom: spacing.space2 }} />
      )}
      <Text variant="title" style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text tone="inkMuted" style={{ textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
