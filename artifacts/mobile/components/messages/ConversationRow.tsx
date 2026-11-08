import React from "react";
import { Pressable, View } from "react-native";

import { Icon } from "@/components/Icon";
import { Pill, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import type { Conversation, GroupConversation } from "@/hooks/useMessages";
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

/**
 * One conversation in Messages (approved canvas: Messages). VoiceOver reads
 * it as a single element: name, unread, blocked, the latest message, and
 * when it was sent. Unread is an ink dot plus a bolder preview, and the word
 * for VoiceOver, so it never relies on color alone.
 */
export function ConversationRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const c = useColors();
  const { other, lastMessage, unread, blocked } = conversation;
  const preview = lastMessage ? `${lastMessage.fromMe ? "You: " : ""}${lastMessage.text}` : "";
  const spoken = [
    other.name,
    unread > 0 ? `${unread} unread` : null,
    blocked ? "Blocked" : null,
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.space3, rowGap: 2 }}>
          <Text variant="bodyStrong" style={{ flexGrow: 1, flexShrink: 1 }}>
            {other.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
            {lastMessage ? (
              <Text variant="small" tone="inkMuted">
                {shortTime(lastMessage.at)}
              </Text>
            ) : null}
            {unread > 0 ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink }} /> : null}
          </View>
        </View>
        <Text variant={unread > 0 ? "bodyStrong" : "small"} tone={unread > 0 ? "ink" : "inkMuted"} numberOfLines={1}>
          {preview}
        </Text>
        {blocked ? <Pill label="Blocked" style={{ marginTop: spacing.space1 }} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * A group chat in Messages (F15): an open match's chat, named for the match
 * ("Sat 9 AM doubles · Beacon Courts"), with the sender before the latest
 * line and the same unread dot and words as a conversation.
 */
export function GroupRow({ group, onPress }: { group: GroupConversation; onPress: () => void }) {
  const c = useColors();
  const { title, lastMessage, unread, memberCount } = group;
  const who = lastMessage ? (lastMessage.fromMe ? "You" : lastMessage.senderName) : null;
  const preview = lastMessage ? `${who ? `${who}: ` : ""}${lastMessage.text}` : "";
  const spoken = [
    `Group chat, ${title}`,
    `${memberCount} ${memberCount === 1 ? "player" : "players"}`,
    unread > 0 ? `${unread} unread` : null,
    lastMessage ? `${who ? `${who}: ` : ""}${lastMessage.text}` : null,
    lastMessage ? spokenTime(lastMessage.at) : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the group chat"
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
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.radiusPill,
          backgroundColor: c.sand,
          borderWidth: 1,
          borderColor: c.hairline,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="person.2" size={22} tintColor={c.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.space3, rowGap: 2 }}>
          <Text variant="bodyStrong" style={{ flexGrow: 1, flexShrink: 1 }}>
            {title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
            {lastMessage ? (
              <Text variant="small" tone="inkMuted">
                {shortTime(lastMessage.at)}
              </Text>
            ) : null}
            {unread > 0 ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink }} /> : null}
          </View>
        </View>
        <Text variant={unread > 0 ? "bodyStrong" : "small"} tone={unread > 0 ? "ink" : "inkMuted"} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}
