import React from "react";

import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";

// Placeholder until Discover is built (spec: Discover).
export default function DiscoverScreen() {
  return (
    <TabScreen title="Discover">
      <EmptyState
        symbol="safari"
        title="Nothing here yet"
        message="Players near you, Open leagues, and Open matches show up here."
      />
    </TabScreen>
  );
}
