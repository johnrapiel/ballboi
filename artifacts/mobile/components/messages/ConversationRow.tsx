import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import type { Conversation } from "@/hooks/useMessages";
import { useColors } from "@/hooks/useColors";
import { initials, shortTime, spokenTime } from "@/lib/messages";

/** Initials in a sand circle. Decorative: the name is always next to it. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const c = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant="bodyStrong" maxFontSizeMultiplier={1.3}>
        {initials(name)}
      </Text>
    </View>
  );
}

function statusText(c: Conversation): string | null {
  if (c.state === "awaiting_reply") return "Waiting for a reply";
  if (c.state === "request") return "Message Request";
  return null;
}

/**
 * One conversation in Messages. VoiceOver reads it as a single element:
 * name, unread count or status, the latest message, and when it was sent.
 */
export function ConversationRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const c = useColors();
  const { other, lastMessage, unread } = conversation;
  const status = statusText(conversation);
  const preview = lastMessage ? `${lastMessage.fromMe ? "You: " : ""}${lastMessage.text}` : "";
  const spoken = [
    other.name,
    unread > 0 ? `${unread} unread` : null,
    status,
    lastMessage ? `${lastMessage.fromMe ? "You" : other.name}: ${lastMessage.text}` : null,
    lastMessage ? spokenTime(lastMessage.at) : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the conversation"
      style={({ pressed }) => ({
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={other.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.space2 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {other.name}
          </Text>
          {lastMessage ? (
            <Text variant="small" tone="inkMuted">
              {shortTime(lastMessage.at)}
            </Text>
          ) : null}
        </View>
        {status ? (
          <Text variant="small" tone="inkMuted" style={{ fontFamily: "DMSans_600SemiBold" }}>
            {status}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          <Text
            variant={unread > 0 ? "bodyStrong" : "body"}
            tone={unread > 0 ? "ink" : "inkMuted"}
            numberOfLines={2}
            style={{ flex: 1 }}
          >
            {preview}
          </Text>
          {unread > 0 ? (
            // Count in text, not a color dot alone.
            <View
              style={{
                minWidth: 24,
                height: 24,
                paddingHorizontal: 6,
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
          ) : null}
        </View>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}

/** Messages / Requests switch. A tab list for VoiceOver; the selected tab is filled and bold. */
export function BoxSwitch({
  value,
  onChange,
  requests,
}: {
  value: "messages" | "requests";
  onChange: (v: "messages" | "requests") => void;
  requests: number;
}) {
  const c = useColors();
  const tabs = [
    { key: "messages" as const, label: "Messages", spoken: "Messages" },
    {
      key: "requests" as const,
      label: requests > 0 ? `Requests (${requests})` : "Requests",
      spoken: requests > 0 ? `Requests, ${requests} waiting` : "Requests",
    },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        marginHorizontal: spacing.space4,
        marginBottom: spacing.space3,
        padding: 2,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
      }}
    >
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.spoken}
            style={{
              flex: 1,
              minHeight: MIN_TAP,
              borderRadius: radius.radiusPill,
              backgroundColor: on ? c.ink : "transparent",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing.space3,
            }}
          >
            <Text variant="button" tone={on ? "onInk" : "ink"} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
