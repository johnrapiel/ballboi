import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { AccessibilityInfo } from "react-native";

import { PartnerOptions, TeamUpRequestCards } from "@/components/league/PartnerCard";
import { SheetBody } from "@/components/Sheet";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// You're in, for a fixed-partner doubles league (finding 33 refined, John,
// Nov 12, 2:14 PM). Singles and rotating doubles go straight to the league
// page; a fixed-partner league opens this sheet in place of the join sheet,
// because picking a partner is the next step: a waiting request to accept,
// Team up with someone, or Find me a partner. It hugs its content like every
// sheet (system grabber, decision 181) and scrolls only at the largest text
// sizes. Open league replaces it with the league page; drag down closes it.

export default function JoinedSheet() {
  const { leagueId: raw, name } = useLocalSearchParams<{ leagueId: string; name?: string }>();
  const leagueId = Number(raw);
  const leagueName = name?.trim() || "the league";

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`You joined ${leagueName}`);
  }, [leagueName]);

  const openLeague = () => router.replace({ pathname: "/league/[leagueId]", params: { leagueId: String(leagueId) } });

  return (
    <SheetBody title="You're in" contentStyle={{ gap: spacing.space4 }}>
      <Text tone="inkMuted">{`You joined ${leagueName}.`}</Text>
      <TeamUpRequestCards leagueId={leagueId} />
      <PartnerOptions
        leagueId={leagueId}
        onTeamUp={() => router.replace({ pathname: "/league/[leagueId]/team-up", params: { leagueId: String(leagueId) } })}
      />
      <Button label="Open league" variant="secondary" onPress={openLeague} />
    </SheetBody>
  );
}
