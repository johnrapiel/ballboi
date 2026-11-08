import { useLocalSearchParams } from "expo-router";
import React from "react";

import { GroupConversation } from "@/components/messages/GroupConversation";

// A group chat opened from Messages or its push (F15). The open match's own
// screens open the same chat by match: app/discover/match/chat/[id].tsx.

export default function GroupConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  return <GroupConversation groupId={Number.isInteger(id) && id > 0 ? id : null} />;
}
