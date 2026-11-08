import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";

import { CornerButton } from "@/components/CornerButton";
import { Text } from "@/components/ui";
import { radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useLeagueChat } from "@/hooks/useMessages";
import { badgeText, chatButtonLabel } from "@/lib/leagueChat";

/**
 * Chat, in the league page's top-right corner (decision 145): a glass corner
 * button (button standard) with the brush chat icon and the chat's unread
 * count. It opens the league's chat, the same conversation listed in
 * Messages. Hidden for someone not in the league.
 */
export function LeagueChatButton({ leagueId }: { leagueId: number }) {
  const c = useColors();
  const router = useRouter();
  const chat = useLeagueChat(Number.isInteger(leagueId) && leagueId > 0 ? leagueId : null);
  if (!chat.data) return null;
  const { groupId, unread } = chat.data;
  return (
    <CornerButton
      symbol="message"
      label={chatButtonLabel(unread)}
      hint="Opens the league chat"
      onPress={() => router.push({ pathname: "/conversation/group/[id]", params: { id: String(groupId) } })}
    >
      {unread > 0 ? (
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          pointerEvents="none"
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
            {badgeText(unread)}
          </Text>
        </View>
      ) : null}
    </CornerButton>
  );
}
