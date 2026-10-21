import React from "react";

import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";

// Placeholder until the recording flow is built (spec: Ball Boi).
export default function BallBoiScreen() {
  return (
    <TabScreen title="Ball Boi">
      <EmptyState
        symbol="tennisball"
        title="No recordings yet"
        message="Record a match to see your shots, replay, and trends here."
      />
    </TabScreen>
  );
}
