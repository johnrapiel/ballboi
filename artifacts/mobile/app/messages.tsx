import React from "react";
import { View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";

// Opens from the Messages button in the top-right corner of every tab.
// Placeholder until messaging is built (spec: Messaging and moderation).
export default function MessagesScreen() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <EmptyState
        symbol="message"
        title="No messages yet"
        message="Messages from players and your match threads show up here."
      />
    </View>
  );
}
