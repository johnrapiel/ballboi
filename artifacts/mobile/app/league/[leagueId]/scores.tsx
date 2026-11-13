import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueBracket, useGetLeagueSchedule } from "@workspace/api-client-react";

import { ROUND_SINGULAR } from "@/components/league/Bracket";

import { ProblemCard } from "@/components/discover/States";
import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { OfflineNotice } from "@/components/OfflineNotice";
import { Card, Text } from "@/components/ui";
import { WinnerNames } from "@/components/WinnerNames";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { correctionLine, dateRange, resultLine } from "@/lib/leagueSchedule";
import { sideOf, winnerMark } from "@/lib/winnerMark";

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
  const pull = usePullToRefresh(() => [leagueQ.refetch(), scheduleQ.refetch(), bracketQ.refetch()]);
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
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
        <Text variant="headingM" accessibilityRole="header">
          Correct a score
        </Text>
        {leagueQ.data?.name ? <Text tone="inkMuted">{leagueQ.data.name}</Text> : null}
        <Text tone="inkMuted">Pick a played match to fix its score. Standings update, and both players see that you corrected it.</Text>
      </View>
      <OfflineNotice pull={pull} style={{ marginBottom: spacing.space2 }} />

      {ended ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">This league has ended, so its scores are final.</Text>
        </Card>
      ) : scheduleQ.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading matches" style={{ marginTop: spacing.space6 }} />
      ) : scheduleQ.isError && !scheduleQ.data ? (
        <ProblemCard
          title="Can't load the matches"
          body="Check your connection and try again."
          onRetry={() => void scheduleQ.refetch()}
          retrying={scheduleQ.isRefetching}
        />
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
                  const p1 = s.player1?.playerName ?? "Player 1";
                  const p2 = s.player2?.playerName ?? "Player 2";
                  const mark = winnerMark({ player1Name: p1, player2Name: p2, score: s.score, winner: sideOf(s.winnerId, s.player1?.playerId, s.player2?.playerId) });
                  return (
                    <ListRow
                      key={s.matchId}
                      title={`${p1} versus ${p2}`}
                      subtitle={mark.spoken}
                      content={<WinnerNames player1Name={p1} player2Name={p2} mark={mark} />}
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
              {played.map((m, i) => {
                const mark = winnerMark({
                  player1Name: m.player1Name,
                  player2Name: m.player2Name,
                  score: m.score,
                  winner: sideOf(m.winnerId, m.player1Id, m.player2Id),
                  status: resultLine(m),
                });
                const corrected = correctionLine(m);
                return (
                <ListRow
                  key={m.matchId}
                  title={`${m.player1Name} versus ${m.player2Name}`}
                  subtitle={[mark.spoken, corrected].filter(Boolean).join(". ")}
                  content={
                    <View style={{ gap: 2 }}>
                      <WinnerNames player1Name={m.player1Name} player2Name={m.player2Name} mark={mark} />
                      {corrected ? (
                        <Text variant="small" tone="inkMuted">
                          {corrected}
                        </Text>
                      ) : null}
                    </View>
                  }
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
                );
              })}
            </Card>
          </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
