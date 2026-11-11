import { useRouter } from "expo-router";
import React, { useRef } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";

import type { Milestone } from "@workspace/api-client-react";

import { MilestoneBadge } from "@/components/MilestoneBadge";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { MILESTONE_SHORT, milestoneBadgeLabel } from "@/lib/milestones";

// The player card's row of earned milestones (decision 150), each with a short
// label under it (John, Nov 10: "What do these icons mean?"). Each badge is a
// button that opens the milestone sheet: the full title, the date earned and
// how it's earned. The card's own VoiceOver summary still lists them too.
//
// Labels wrap inside each button, and the row wraps onto more lines as text
// gets larger, so nothing clips at the largest sizes.

/** Width of one badge and its label at the default text size. Grows with Dynamic Type. */
const ITEM_WIDTH = 84;

/** Opens the milestone sheet for one badge. */
export function useOpenMilestone() {
  const router = useRouter();
  // A quick double tap opens one sheet, not two stacked.
  const last = useRef(0);
  return (m: Pick<Milestone, "kind" | "earnedAt">) => {
    const now = Date.now();
    if (now - last.current < 800) return;
    last.current = now;
    router.push({ pathname: "/milestone", params: { kind: m.kind, earnedAt: m.earnedAt } });
  };
}

export function MilestoneButtons({ milestones }: { milestones: Pick<Milestone, "kind" | "earnedAt">[] }) {
  const open = useOpenMilestone();
  const { fontScale, width } = useWindowDimensions();
  // Wider with larger text so a word never breaks mid-word, but never wider than the card.
  const itemWidth = Math.min(Math.round(ITEM_WIDTH * Math.max(1, fontScale)), width - spacing.space12 * 2);
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "flex-start",
        columnGap: spacing.space1,
        rowGap: spacing.space2,
        marginTop: spacing.space3,
        paddingHorizontal: spacing.space4,
        width: "100%",
      }}
    >
      {milestones.map((m) => (
        <Pressable
          key={m.kind}
          onPress={() => open(m)}
          accessibilityRole="button"
          accessibilityLabel={milestoneBadgeLabel(m)}
          accessibilityHint="Shows details"
          style={({ pressed }) => ({
            width: itemWidth,
            minHeight: MIN_TAP,
            alignItems: "center",
            gap: spacing.space1,
            paddingVertical: spacing.space1,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <MilestoneBadge kind={m.kind} size={32} />
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {MILESTONE_SHORT[m.kind]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
