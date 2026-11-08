import { useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Roundel } from "@/components/Roundel";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { badgeCount, useMessagesSummary } from "@/hooks/useMessages";

/**
 * Messages, in a 44pt circle in the top-right corner of every tab.
 * Shows an unread count when there is one, and VoiceOver reads it.
 */
export function MessagesButton({ unread = 0 }: { unread?: number }) {
  const c = useColors();
  const router = useRouter();
  const label = unread > 0 ? `Messages, ${unread} unread` : "Messages";

  return (
    <Pressable
      onPress={() => router.push("/messages")}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="message" size={20} tintColor={c.ink} />
      {unread > 0 && (
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: radius.radiusPill,
            backgroundColor: c.ink,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="label" tone="onInk" maxFontSizeMultiplier={1.4}>
            {unread > 99 ? "99+" : unread}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** A tab's page: paper background, safe-area top, and the tab header. */
export function TabScreen({
  title,
  action,
  roundel,
  bare,
  children,
}: {
  title: string;
  /** An optional button for the tab's main action, shown next to Messages. */
  action?: React.ReactNode;
  /** Show the roundel in place of the title. Home only. */
  roundel?: boolean;
  /** No roundel or title: Home with nothing to show yet, where the roundel sits in the empty state. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper, paddingTop: insets.top + spacing.space2 }}>
      <TabHeader title={title} action={action} roundel={roundel} bare={bare} />
      {children}
    </View>
  );
}

/**
 * Top of every tab: the tab's name as a large brush title, echoing the
 * roundel's lettering, with Messages in the top-right corner. The title
 * always matches the tab label. Home shows the roundel alone, left aligned,
 * with no title, date or greeting (John, Nov 5); VoiceOver still reads the
 * tab's name as the header. With nothing on Home yet, the header is bare and
 * the roundel sits large in the empty state instead (finding 27, Nov 6).
 */
export function TabHeader({
  title,
  action,
  roundel,
  bare,
}: {
  title: string;
  action?: React.ReactNode;
  roundel?: boolean;
  bare?: boolean;
}) {
  const summary = useMessagesSummary();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingBottom: spacing.space3,
      }}
    >
      {bare ? (
        <View accessible accessibilityRole="header" accessibilityLabel={title} style={{ minHeight: 44, minWidth: 44 }} />
      ) : roundel ? (
        <View accessible accessibilityRole="header" accessibilityLabel={title}>
          <Roundel size={52} />
        </View>
      ) : (
        <Text variant="headingL" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {title}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        {action}
        <MessagesButton unread={badgeCount(summary.data)} />
      </View>
    </View>
  );
}
