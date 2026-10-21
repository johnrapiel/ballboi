import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

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
      <SymbolView name="message" size={20} tintColor={c.ink} />
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
export function TabScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper, paddingTop: insets.top + spacing.space2 }}>
      <TabHeader title={title} />
      {children}
    </View>
  );
}

/**
 * Top of every tab: the tab's name as a large title, with Messages
 * in the top-right corner. The title always matches the tab label.
 */
export function TabHeader({ title }: { title: string }) {
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
      <Text variant="displayL" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <MessagesButton />
    </View>
  );
}
