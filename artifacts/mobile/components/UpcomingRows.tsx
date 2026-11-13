import React from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { rowSpoken, rowSub, rowWhen, type UpcomingItem } from "@/lib/upcoming";

// Upcoming match rows (canvas W2_HomeUpcoming, W2_ProfileCard): the date and
// time over who it's against and where it comes from, with a chevron. The
// whole row is one VoiceOver button. A late match shows "Late" with an
// hourglass beside its date (canvas B3, walkthrough 11.4).

export function UpcomingRows({
  items,
  onOpen,
  hint,
  canOpen = () => true,
}: {
  items: UpcomingItem[];
  onOpen: (m: UpcomingItem) => void;
  /** VoiceOver hint for a row, by kind of match. */
  hint: (m: UpcomingItem) => string;
  /** Someone else's card: only your own matches open. The rest are plain rows. */
  canOpen?: (m: UpcomingItem) => boolean;
}) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {items.map((m, n) => {
        const opens = canOpen(m);
        const row = {
          minHeight: 56,
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: spacing.space3,
          paddingHorizontal: spacing.space4,
          paddingVertical: spacing.space3,
          borderBottomWidth: n === items.length - 1 ? 0 : 1,
          borderBottomColor: c.hairline,
        };
        const body = (
          <>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 }}>
                <Text variant="bodyStrong" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
                  {rowWhen(m)}
                </Text>
                {/* A late match (decision 152) says so in a word with an icon, not color alone (canvas B3, finding 47). */}
                {m.grace ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
                    <Icon name="hourglass" size={16} tintColor={c.ink} />
                    <Text variant="bodyStrong">Late</Text>
                  </View>
                ) : null}
              </View>
              <Text variant="small" tone="inkMuted">
                {rowSub(m)}
              </Text>
            </View>
            {opens ? <Icon name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
          </>
        );
        return opens ? (
          <Pressable
            key={m.key}
            onPress={() => onOpen(m)}
            accessibilityRole="button"
            accessibilityLabel={rowSpoken(m)}
            accessibilityHint={hint(m)}
            style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={m.key} accessible accessibilityLabel={rowSpoken(m)} style={row}>
            {body}
          </View>
        );
      })}
    </Card>
  );
}
