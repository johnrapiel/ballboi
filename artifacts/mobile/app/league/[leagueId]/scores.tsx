import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueBracket, useGetLeagueSchedule } from "@workspace/api-client-react";

import { ROUND_SINGULAR } from "@/components/league/Bracket";

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine, dateRange, resultLine } from "@/lib/leagueSchedule";
import { slotWinningScore } from "@/lib/playoffView";

// Correct a score (Oct 31 review, C5). Manage > Correct a score lists every
// played match by round, newest first. Tap one to enter the corrected sets
// and confirm; standings recompute and both players see "Corrected by
// {admin} on {date}". A playoff score can be corrected until the match it
// feeds has been played; the corrected winner takes that spot. Once the
// league ends, scores are final and nothing here can change (Q9).

export default function CorrectScoresScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const leagueQ = useGetLeague(leagueId);
  const ended = !!leagueQ.data?.endedAt || leagueQ.data?.status === "completed";
  const scheduleQ = useGetLeagueSchedule(leagueId);
  const bracketQ = useGetLeagueBracket(leagueId);
  const playoffRounds = (bracketQ.data?.rounds ?? [])
    .map((r) => ({ round: r.round, played: r.slots.filter((s) => s.status === "completed" && !!s.score && s.matchId != null) }))
    .filter((r) => r.played.length > 0)
    .reverse();

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

      {ended ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">This league has ended, so its scores are final.</Text>
        </Card>
      ) : scheduleQ.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading matches" style={{ marginTop: spacing.space6 }} />
      ) : scheduleQ.isError ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">Couldn't load the matches</Text>
          <Text variant="small" tone="inkMuted">
            Pull down to try again.
          </Text>
        </Card>
      ) : rounds.length === 0 && playoffRounds.length === 0 ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">No scores yet</Text>
          <Text variant="small" tone="inkMuted">
            Matches show up here once a player enters a score.
          </Text>
        </Card>
      ) : (
        <>
          {playoffRounds.map(({ round, played }) => (
            <View key={`po-${round}`} style={{ gap: spacing.space2 }}>
              <SectionLabel>{`Playoffs · ${ROUND_SINGULAR[round]}`}</SectionLabel>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {played.map((s, i) => {
                  const winner = s.winnerId === s.player1?.playerId ? s.player1?.playerName : s.player2?.playerName;
                  return (
                    <ListRow
                      key={s.matchId}
                      title={`${s.player1?.playerName ?? "Player 1"} vs. ${s.player2?.playerName ?? "Player 2"}`}
                      subtitle={`${winner ?? "Winner"} won ${slotWinningScore(s) ?? s.score}`}
                      trailing="Correct"
                      onPress={() =>
                        router.push({
                          pathname: "/league/[leagueId]/score/[matchId]",
                          params: { leagueId: String(leagueId), matchId: String(s.matchId), correct: "1" },
                        })
                      }
                      accessibilityHint="Opens the score to correct it. Allowed until the next round is played."
                      last={i === played.length - 1}
                    />
                  );
                })}
              </Card>
            </View>
          ))}
          {rounds.map(({ round, played }) => (
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
          ))}
        </>
      )}
    </ScrollView>
  );
}
