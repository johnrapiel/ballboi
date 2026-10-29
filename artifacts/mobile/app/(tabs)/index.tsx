import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyLeagueWeek, type LeagueWeekItem, type LeagueWeekResult } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { ListRow } from "@/components/league/ListRow";
import { MatchCard } from "@/components/MatchCard";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dateRange, shortDate } from "@/lib/leagueSchedule";

// Home (spec: Navigation > Home: upcoming matches, this week's pairings,
// recent results). Pending match requests join this tab with Discover.

function weekDetail(i: LeagueWeekItem): string {
  if (i.phase === "upcoming") return `Starts ${shortDate(i.startDate)}. Play by ${shortDate(i.deadline)}.`;
  if (i.phase === "grace") return `Grace week until ${shortDate(i.graceEnd)}.`;
  return `Play by ${shortDate(i.deadline)}.`;
}

function ResultRow({ r, last, onPress }: { r: LeagueWeekResult; last: boolean; onPress: () => void }) {
  const outcome = r.won ? "Won" : "Lost";
  const sub = [`vs. ${r.opponentName}`, r.leagueName, r.playoff ? "Playoffs" : null, r.inGrace ? "Grace week, not in standings" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ListRow
      title={`${outcome} ${r.score}`}
      subtitle={sub}
      symbol={r.won ? "checkmark.circle" : "xmark.circle"}
      onPress={onPress}
      accessibilityHint="Opens the league"
      last={last}
    />
  );
}

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const weekQ = useGetMyLeagueWeek();
  const week = weekQ.data;

  const openLeague = (leagueId: number) => router.push(`/league/${leagueId}`);
  const enterScore = (leagueId: number, matchId: number) => router.push(`/league/${leagueId}/score/${matchId}`);

  const nothing =
    !!week && week.thisWeek.length === 0 && week.playoffs.length === 0 && week.drafts.length === 0 && week.recent.length === 0;

  return (
    <TabScreen title="Home">
      {weekQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
        </View>
      ) : nothing ? (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          <EmptyState symbol="tennisball" title="No league matches yet" message="Start or join a league, and your matches show up here each week." />
          <View style={{ paddingHorizontal: spacing.space4, paddingBottom: spacing.space8 }}>
            <Button label="Go to Leagues" variant="secondary" onPress={() => router.push("/(tabs)/leagues")} />
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space3 }}
          refreshControl={<RefreshControl refreshing={weekQ.isRefetching} onRefresh={() => void weekQ.refetch()} tintColor={c.ink} />}
        >
          {weekQ.isError ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your matches</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : null}

          {week?.drafts.map((d) => (
            <MatchCard
              key={`draft-${d.roundId}`}
              eyebrow={`${d.leagueName} · Admin`}
              title={`Round ${d.roundNumber} pairings are ready to review`}
              detail={`They go out to players ${shortDate(d.startDate)} at 7am.`}
              primary={{ label: "Review pairings", onPress: () => router.push(`/league/${d.leagueId}/round/${d.roundId}`) }}
            />
          ))}

          {week && (week.playoffs.length > 0 || week.thisWeek.length > 0) ? (
            <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
              This week
            </Text>
          ) : null}

          {week?.playoffs.map((p) => (
            <MatchCard
              key={`po-${p.matchId}`}
              eyebrow={`${p.leagueName} · Playoffs · ${ROUND_SINGULAR[p.round as keyof typeof ROUND_SINGULAR] ?? "Playoff"}`}
              title={`You vs. ${p.opponentName}`}
              onOpen={() => openLeague(p.leagueId)}
              primary={{ label: "Enter score", onPress: () => enterScore(p.leagueId, p.matchId), hint: `For your match against ${p.opponentName}` }}
            />
          ))}

          {week?.thisWeek.map((i) =>
            i.bye ? (
              <MatchCard
                key={`bye-${i.roundId}`}
                eyebrow={`${i.leagueName} · Round ${i.roundNumber} · ${dateRange(i.startDate, i.deadline)}`}
                title="You have a bye this week"
                onOpen={() => openLeague(i.leagueId)}
              />
            ) : (
              <MatchCard
                key={`m-${i.matchId}`}
                eyebrow={`${i.leagueName} · Round ${i.roundNumber}`}
                title={`You vs. ${i.opponentName ?? "your opponent"}`}
                detail={weekDetail(i)}
                note={i.phase === "grace" ? "A score now counts for Ball Boi stats, not standings." : null}
                onOpen={() => openLeague(i.leagueId)}
                primary={
                  i.phase !== "upcoming" && i.matchId != null
                    ? {
                        label: "Enter score",
                        onPress: () => enterScore(i.leagueId, i.matchId!),
                        hint: `For your match against ${i.opponentName ?? "your opponent"}`,
                      }
                    : null
                }
              />
            ),
          )}

          {week && week.recent.length > 0 ? (
            <>
              <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
                Recent results
              </Text>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {week.recent.map((r, n) => (
                  <ResultRow key={r.matchId} r={r} last={n === week.recent.length - 1} onPress={() => openLeague(r.leagueId)} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </TabScreen>
  );
}
