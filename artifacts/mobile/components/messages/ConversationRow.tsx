import React from "react";
import { Pressable, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Pill, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import type { Conversation, GroupConversation } from "@/hooks/useMessages";
import { useColors } from "@/hooks/useColors";
import { badgeText, leagueRowLabel } from "@/lib/leagueChat";
import { shortTime, spokenTime } from "@/lib/messages";

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
      <Avatar name={other.name} uri={other.avatarUrl} size={44} />
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
 * A group chat in Messages: an open match's chat (F15), named for the match
 * ("Sat 9 AM doubles · Beacon Courts"), or a league's chat (decision 145),
 * named for the league with the brush leagues icon (the Leagues tab's own
 * mark), so it reads as a group, not a person. The sender comes before the
 * latest line. Unread is an ink dot for a match chat; a league chat shows
 * bold with its own count (decision 146), and VoiceOver hears the number.
 */
export function GroupRow({ group, onPress }: { group: GroupConversation; onPress: () => void }) {
  const c = useColors();
  const { title, lastMessage, unread, memberCount } = group;
  const league = group.kind === "league";
  const who = lastMessage ? (lastMessage.fromMe ? "You" : lastMessage.senderName) : null;
  const preview = lastMessage ? `${who ? `${who}: ` : ""}${lastMessage.text}` : league ? "No messages yet" : "";
  const spoken = league
    ? leagueRowLabel(group, lastMessage ? spokenTime(lastMessage.at) : null)
    : [
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
      accessibilityHint={league ? "Opens the league chat" : "Opens the group chat"}
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
        <Icon name={league ? "trophy" : "person.2"} size={22} tintColor={c.ink} />
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
            {unread > 0 && league ? (
              <View
                style={{
                  minWidth: 22,
                  height: 22,
                  paddingHorizontal: 6,
                  borderRadius: radius.radiusPill,
                  backgroundColor: c.ink,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text variant="label" tone="onInk" maxFontSizeMultiplier={1.4}>
                  {badgeText(unread)}
                </Text>
              </View>
            ) : unread > 0 ? (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink }} />
            ) : null}
          </View>
        </View>
        <Text variant={unread > 0 ? "bodyStrong" : "small"} tone={unread > 0 ? "ink" : "inkMuted"} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}
