import React from "react";

import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";

// Placeholder until the Leagues flow is built (spec: Leagues).
export default function LeaguesScreen() {
  return (
    <TabScreen title="Leagues">
      <EmptyState
        symbol="trophy"
        title="No leagues yet"
        message="Leagues you start or join show up here."
      />
    </TabScreen>
  );
}
