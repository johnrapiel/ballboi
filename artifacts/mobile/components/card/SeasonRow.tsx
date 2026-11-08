import React from "react";
import { View } from "react-native";

import type { PlayerCardSeason } from "@workspace/api-client-react";

import { StatGrid } from "@/components/card/StatGrid";
import { SectionHead } from "@/components/SectionHead";
import { spacing } from "@/constants/tokens";
import { seasonCells, seasonSpoken } from "@/lib/playerCard";

// This season under the player card (decision 139; canvas W2_ProfileCard):
// Record, Played, Streak and No-shows in one row, split by hairlines, read
// by VoiceOver as one group. Played and No-shows follow F13 (decision 121).
// The streak is a letter and a number, never a color. On your own Profile,
// See all opens Career (decision 147).

export function SeasonRow({ season, onSeeAll }: { season: PlayerCardSeason; onSeeAll?: () => void }) {
  return (
    <View style={{ gap: spacing.space2 }}>
      <SectionHead title="This season" onSeeAll={onSeeAll} seeAllLabel="See all: your career stats" />
      <StatGrid cells={seasonCells(season)} spoken={seasonSpoken(season)} columns={4} />
    </View>
  );
}
