import React from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { rowSpoken, rowSub, rowWhen, type UpcomingItem } from "@/lib/upcoming";

// Upcoming match rows (canvas W2_HomeUpcoming, W2_ProfileCard): the date and
// time over who it's against and where it comes from, with a chevron. The
// whole row is one VoiceOver button.

export function UpcomingRows({
  items,
  onOpen,
  hint,
}: {
  items: UpcomingItem[];
  onOpen: (m: UpcomingItem) => void;
  /** VoiceOver hint for a row, by kind of match. */
  hint: (m: UpcomingItem) => string;
}) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {items.map((m, n) => (
        <Pressable
          key={m.key}
          onPress={() => onOpen(m)}
          accessibilityRole="button"
          accessibilityLabel={rowSpoken(m)}
          accessibilityHint={hint(m)}
          style={({ pressed }) => ({
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.space3,
            paddingHorizontal: spacing.space4,
            paddingVertical: spacing.space3,
            borderBottomWidth: n === items.length - 1 ? 0 : 1,
            borderBottomColor: c.hairline,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
              {rowWhen(m)}
            </Text>
            <Text variant="small" tone="inkMuted">
              {rowSub(m)}
            </Text>
          </View>
          <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
        </Pressable>
      ))}
    </Card>
  );
}
