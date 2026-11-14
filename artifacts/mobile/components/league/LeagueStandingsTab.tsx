import React from "react";
import { View } from "react-native";

import type { Standing } from "@workspace/api-client-react";

import { StandingsTable } from "@/components/league/StandingsTable";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { tiebreakLine, type StandingsSummary } from "@/lib/leaguePage";

// The league page's Standings tab (Wave 3, decision 210; L1, L3, L6, Nov 14):
// your summary, the table with your row ringed, then how ranks are decided.

const SCORE = { fontSize: 26, lineHeight: 30 } as const;

function SummaryCard({ summary }: { summary: StandingsSummary }) {
  return (
    <Card accessible accessibilityLabel={summary.spoken} style={{ gap: 2 }}>
      <Text variant="section" tone="inkMuted">
        {summary.eyebrow}
      </Text>
      {/* Place and record in Cormorant at full ink, like a score (design system: Type). */}
      <Text variant="scoreRow" style={SCORE}>
        {summary.title}
      </Text>
      {summary.line ? (
        <Text variant="small" tone="inkMuted">
          {summary.line}
        </Text>
      ) : null}
    </Card>
  );
}

export function LeagueStandingsTab({
  standings,
  summary,
  myPlayerId,
  started,
  playoffsNote,
}: {
  standings: Standing[];
  summary: StandingsSummary | null;
  myPlayerId: number | null;
  started: boolean;
  /** "Top 4 make the playoffs." or null. */
  playoffsNote: string | null;
}) {
  const teams = standings.some((r) => r.teamId != null);
  return (
    <View style={{ gap: spacing.space4 }}>
      {summary ? <SummaryCard summary={summary} /> : null}
      {standings.length === 0 ? (
        <Card>
          <Text tone="inkMuted">Standings show up here after the first scores are in.</Text>
        </Card>
      ) : (
        <StandingsTable standings={standings} myPlayerId={myPlayerId} beforeStart={!started} />
      )}
      <Text variant="small" tone="inkMuted">
        {tiebreakLine(teams, playoffsNote)}
      </Text>
    </View>
  );
}
