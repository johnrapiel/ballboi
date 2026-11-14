import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useOpenDoublesMatchChat } from "@workspace/api-client-react";

import type { NextMatchAction } from "@/components/NextMatchCard";
import type { UpcomingItem } from "@/lib/upcoming";

/**
 * The Message button on the next-match card, shared by Home and Match detail
 * (finding 9). A Discover match opens your chat with the other player, a
 * league match your chat with your opponent, and a doubles league match one
 * group chat for all four (D6). Null when there's no one to message.
 */
export function useUpcomingMessage() {
  const router = useRouter();
  const openChat = useOpenDoublesMatchChat();
  const { mutateAsync } = openChat;

  const message = useCallback(
    (m: UpcomingItem): NextMatchAction | null => {
      const opponent = m.opponentName ?? "your opponent";
      // An open match's group chat opens once it's full (F15, finding 63).
      if (m.kind === "open") {
        if (m.openMatchId == null || m.openStatus !== "Full") return null;
        return {
          label: "Message",
          accessibilityLabel: m.singles && m.opponentName ? `Message ${opponent}` : "Message everyone in this match",
          hint: "Opens the group chat",
          onPress: () => router.push({ pathname: "/discover/match/chat/[id]", params: { id: String(m.openMatchId) } }),
        };
      }
      const doublesChat = m.kind === "league" && !!m.partnerName && m.leagueId != null && m.matchId != null;
      if (doublesChat) {
        return {
          label: "Message",
          accessibilityLabel: "Message all four players",
          hint: "Opens one group chat for the four of you",
          onPress: () =>
            void mutateAsync({ leagueId: m.leagueId!, matchId: m.matchId! })
              .then(({ groupId }) => router.push({ pathname: "/conversation/group/[id]", params: { id: String(groupId) } }))
              .catch((e) => Alert.alert("Couldn't open the chat", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.")),
        };
      }
      const chatWith = m.otherUserId
        ? { id: "new", userId: String(m.otherUserId), name: opponent }
        : m.opponentPlayerId
          ? { id: "new", playerId: String(m.opponentPlayerId), name: opponent }
          : null;
      if (!chatWith) return null;
      return {
        label: "Message",
        accessibilityLabel: `Message ${opponent}`,
        hint: "Opens a direct chat",
        onPress: () => router.push({ pathname: "/conversation/[id]", params: chatWith }),
      };
    },
    [mutateAsync, router],
  );

  return { message, isPending: openChat.isPending };
}
