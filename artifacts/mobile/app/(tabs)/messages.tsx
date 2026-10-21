import React from "react";

import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";

// Placeholder until messaging is built (spec: Messaging and moderation).
export default function MessagesScreen() {
  return (
    <TabScreen title="Messages">
      <EmptyState
        symbol="message"
        title="No messages yet"
        message="Messages from players and your match threads show up here."
      />
    </TabScreen>
  );
}
