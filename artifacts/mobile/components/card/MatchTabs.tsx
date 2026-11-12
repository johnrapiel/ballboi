import React from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { OWN_TABS, TAB_LABELS, type MatchTab } from "@/lib/playerCard";

// Light text tabs, Upcoming matches and Results (decision 138; canvas
// W2_ProfileCard, W2_ProfileResults), with no heading above them. The
// selected tab is ink, semibold and underlined; the other is muted. Never
// color alone. Your own Profile leads with Upcoming matches; another
// player's page passes THEIR_TABS to lead with Results (Wave 2 finding 37).
// VoiceOver reads them in the order shown.

export function MatchTabs({
  tab,
  onChange,
  counts,
  order = OWN_TABS,
}: {
  tab: MatchTab;
  onChange: (t: MatchTab) => void;
  counts: Record<MatchTab, number>;
  order?: MatchTab[];
}) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.space6, paddingHorizontal: spacing.space1 }}>
      {order.map((t, i) => {
        const on = t === tab;
        return (
          <Pressable
            key={t}
            onPress={() => {
              onChange(t);
              const n = counts[t];
              AccessibilityInfo.announceForAccessibility(`${TAB_LABELS[t]}, ${n} ${n === 1 ? "match" : "matches"}`);
            }}
            accessibilityRole="tab"
            accessibilityLabel={TAB_LABELS[t]}
            accessibilityState={{ selected: on }}
            accessibilityHint={`Tab ${i + 1} of ${order.length}`}
            style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text
              variant={on ? "bodyStrong" : "body"}
              tone={on ? "ink" : "inkMuted"}
              style={on ? { textDecorationLine: "underline", textDecorationColor: c.ink } : undefined}
            >
              {TAB_LABELS[t]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** An empty tab: what shows up here. */
export function EmptyTab({ title, message }: { title: string; message: string }) {
  return (
    <View accessible accessibilityLabel={`${title}. ${message}`} style={{ alignItems: "center", gap: spacing.space2, paddingVertical: spacing.space6, paddingHorizontal: spacing.space4 }}>
      <Text variant="bodyStrong" style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text tone="inkMuted" style={{ textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
