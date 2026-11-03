import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueSchedule } from "@workspace/api-client-react";

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine, dateRange, resultLine } from "@/lib/leagueSchedule";

// Correct a score (Oct 31 review, C5). Manage > Correct a score lists every
// played match by round, newest first. Tap one to enter the corrected sets
// and confirm; standings recompute and both players see "Corrected by
// {admin} on {date}". Playoff scores aren't listed: the winner has already
// moved on to the next round.

export default function CorrectScoresScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const leagueQ = useGetLeague(leagueId);
  const scheduleQ = useGetLeagueSchedule(leagueId);

  const rounds = (scheduleQ.data?.rounds ?? [])
    .map((r) => ({ round: r, played: r.matches.filter((m) => m.status === "completed" && !!m.score && !m.voided) }))
    .filter((r) => r.played.length > 0)
    .sort((a, b) => b.round.roundNumber - a.round.roundNumber);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space2 }}
      refreshControl={<RefreshControl refreshing={scheduleQ.isRefetching} onRefresh={() => void scheduleQ.refetch()} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
        <Text variant="label" tone="inkMuted">
          {leagueQ.data?.name ?? ""}
        </Text>
        <Text variant="displayL" accessibilityRole="header">
          Correct a score
        </Text>
        <Text tone="inkMuted">Pick a played match to fix its score. Standings update, and both players see that you corrected it.</Text>
      </View>

      {scheduleQ.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading matches" style={{ marginTop: spacing.space6 }} />
      ) : scheduleQ.isError ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">Couldn't load the matches</Text>
          <Text variant="small" tone="inkMuted">
            Pull down to try again.
          </Text>
        </Card>
      ) : rounds.length === 0 ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">No scores yet</Text>
          <Text variant="small" tone="inkMuted">
            Matches show up here once a player enters a score.
          </Text>
        </Card>
      ) : (
        rounds.map(({ round, played }) => (
          <View key={round.roundId} style={{ gap: spacing.space2 }}>
            <SectionLabel>{`Round ${round.roundNumber} · ${dateRange(round.startDate, round.deadline)}`}</SectionLabel>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {played.map((m, i) => (
                <ListRow
                  key={m.matchId}
                  title={`${m.player1Name} vs. ${m.player2Name}`}
                  subtitle={[resultLine(m), correctionLine(m)].filter(Boolean).join(". ")}
                  trailing="Correct"
                  onPress={() =>
                    router.push({
                      pathname: "/league/[leagueId]/score/[matchId]",
                      params: { leagueId: String(leagueId), matchId: String(m.matchId), correct: "1" },
                    })
                  }
                  accessibilityHint="Opens the score to correct it"
                  last={i === played.length - 1}
                />
              ))}
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}
