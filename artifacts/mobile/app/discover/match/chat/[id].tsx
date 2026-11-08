import { useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";

import { GroupConversation } from "@/components/messages/GroupConversation";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useOpenMatch } from "@/hooks/useDiscoverOpenMatches";

// The group chat of a filled open match, opened from the match, Home or My
// matches (canvas W2_GroupChat). Since F15 (John, Nov 8) it's the same chat
// as in Messages: this finds the match's chat and shows it.

export default function OpenMatchChatScreen() {
  const c = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const match = useOpenMatch(id);
  const m = match.data;

  if (match.isError && !m) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space6, gap: spacing.space4, justifyContent: "center" }}>
        <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
          {match.error.message}
        </Text>
        <Button label="Try again" variant="secondary" onPress={() => void match.refetch()} />
      </View>
    );
  }
  if (m && m.chatId === null) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space6, justifyContent: "center" }}>
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          The group chat opens when every spot is filled.
        </Text>
      </View>
    );
  }
  return <GroupConversation groupId={m?.chatId ?? null} fallbackTitle={m?.chatTitle} fallbackOpenMatchId={id} />;
}
