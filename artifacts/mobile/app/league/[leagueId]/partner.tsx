import { router, useLocalSearchParams } from "expo-router";
import React from "react";

import { PartnerOptions } from "@/components/league/PartnerCard";
import { SheetBody } from "@/components/Sheet";
import { spacing } from "@/constants/tokens";

// Team up (finding 31, decision 185, John, Nov 12): opened from "Team up" in
// the partner line on a fixed-partner league's page. It holds the explanation
// and the two options: Team up with someone (primary, opens the list of
// people to ask in its place) and Find me a partner (secondary). Or, once
// you've asked someone, where that stands. Nothing is typed, so closing
// never asks.

export default function PartnerSheet() {
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  return (
    <SheetBody title="Team up" contentStyle={{ gap: spacing.space4 }}>
      <PartnerOptions
        leagueId={leagueId}
        onTeamUp={() => router.replace({ pathname: "/league/[leagueId]/team-up", params: { leagueId: String(leagueId) } })}
      />
    </SheetBody>
  );
}
