// A milestone's sheet (John, Nov 10: "What do these icons mean?"), from a
// badge on any player card or a row on Career. The full title as the sheet
// title, the badge, the date it was earned, and one plain line on how it's
// earned. Read only. Sheet rules: hugs its content, no Cancel, drag down to
// close.

import { useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";

import type { MilestoneKind } from "@workspace/api-client-react";

import { MilestoneBadge } from "@/components/MilestoneBadge";
import { SheetBody } from "@/components/Sheet";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { earnedLine, MILESTONE_HOW, MILESTONE_TITLES } from "@/lib/milestones";

export default function MilestoneSheet() {
  const params = useLocalSearchParams<{ kind?: string; earnedAt?: string }>();
  const kind = params.kind && Object.prototype.hasOwnProperty.call(MILESTONE_TITLES, params.kind) ? (params.kind as MilestoneKind) : null;

  if (!kind) {
    return (
      <SheetBody title="Milestone">
        <Text tone="inkMuted">This milestone needs a newer version of Ball Boi. Update the app to see it.</Text>
      </SheetBody>
    );
  }

  return (
    <SheetBody title={MILESTONE_TITLES[kind]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space4 }}>
        <MilestoneBadge kind={kind} size={64} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {params.earnedAt ? earnedLine(params.earnedAt) : "Earned"}
        </Text>
      </View>
      <Text>{MILESTONE_HOW[kind]}</Text>
    </SheetBody>
  );
}
