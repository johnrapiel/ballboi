import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeagueMembershipQueryKey,
  getGetLeagueQueryKey,
  getGetLeagueScheduleQueryKey,
  getGetLeagueStandingsQueryKey,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  useGetLeague,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useLeaveLeague,
  useGetLeagueSchedule,
  useGetLeagueStandings,
  type ScheduleMatch,
} from "@workspace/api-client-react";

import { RoundCard, UpcomingWeekRow } from "@/components/league/RoundCard";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { IconButton } from "@/components/Choice";
import { StandingsTable } from "@/components/league/StandingsTable";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { canEnterScore, dateRange, myWeek, opponentName, shortDate } from "@/lib/leagueSchedule";
import { formatLabel, playersLabel, playTypeLabel } from "@/lib/leagues";

// League (spec: Leagues; canvas: League · Standings, Rounds, Playoffs).
// Your match this week sits on top, then Standings, Rounds, and Playoffs.

type Tab = "standings" | "rounds" | "playoffs";

function YourWeek({
  leagueId,
  week,
  myPlayerId,
}: {
  leagueId: number;
  week: NonNullable<ReturnType<typeof myWeek>>;
  myPlayerId: number;
}) {
  const { round, match, bye } = week;
  const label = `Round ${round.roundNumber} · ${dateRange(round.startDate, round.deadline)}`;

  if (bye) {
    return (
      <Card accessible accessibilityLabel={`${label}. You have a bye this week.`} style={{ gap: spacing.space1 }}>
        <Text variant="label" tone="inkMuted">
          {label}
        </Text>
        <Text variant="titleItalic">You have a bye this week.</Text>
      </Card>
    );
  }
  if (!match) return null;

  const opponent = opponentName(match, myPlayerId);
  const scoreable = canEnterScore(round, match);
  const when =
    round.phase === "upcoming"
      ? `Starts ${shortDate(round.startDate)}. Play by ${shortDate(round.deadline)}.`
      : round.phase === "grace"
        ? `Grace week until ${shortDate(round.graceEnd)}. A score now counts for Ball Boi stats, not standings.`
        : `Play by ${shortDate(round.deadline)}.`;

  return (
    <Card style={{ gap: spacing.space3 }}>
      <View accessible accessibilityLabel={`Your match. ${label}. You versus ${opponent}. ${when}`} style={{ gap: spacing.space1 }}>
        <Text variant="label" tone="inkMuted">
          {label}
        </Text>
        <Text variant="title">{`You vs. ${opponent}`}</Text>
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
      </View>
      {scoreable ? (
        <Button
          label="Enter score"
          accessibilityHint={`For your match against ${opponent}`}
          onPress={() => router.push(`/league/${leagueId}/score/${match.matchId}`)}
        />
      ) : null}
    </Card>
  );
}

export default function LeagueScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const [tab, setTab] = useState<Tab>("standings");
  const queryClient = useQueryClient();
  const leave = useLeaveLeague();

  const leagueQ = useGetLeague(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const standingsQ = useGetLeagueStandings(leagueId);
  const scheduleQ = useGetLeagueSchedule(leagueId);
  const bracketQ = useGetLeagueBracket(leagueId);

  const league = leagueQ.data;
  const myPlayerId = membershipQ.data?.playerId ?? null;
  const schedule = scheduleQ.data;
  const standings = standingsQ.data ?? [];
  const week = myWeek(schedule, myPlayerId);
  const bracket = bracketQ.data ?? null;
  const playoff = myPlayoffMatch(bracket, myPlayerId);
  const rounds = (schedule?.rounds ?? []).filter((r) => r.phase !== "draft").slice().reverse();

  const refreshing = leagueQ.isRefetching || standingsQ.isRefetching || scheduleQ.isRefetching;
  const refresh = () => {
    void leagueQ.refetch();
    void membershipQ.refetch();
    void standingsQ.refetch();
    void scheduleQ.refetch();
    void bracketQ.refetch();
  };

  const enterScore = (m: ScheduleMatch) => router.push(`/league/${leagueId}/score/${m.matchId}`);

  if (leagueQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading league" />
      </View>
    );
  }

  const eyebrow = league
    ? [formatLabel(league.format), playTypeLabel(league.leagueType), league.location].filter(Boolean).join(" · ")
    : "";
  const season =
    league?.startDate && league.endDate ? `Season ${dateRange(league.startDate, league.endDate)}` : null;

  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;

  // Dropouts (decision 27): played matches stay, the rest are cancelled.
  function confirmLeave() {
    if (!league) return;
    Alert.alert(
      `Leave ${league.name}?`,
      started
        ? "Your played matches stay. Your remaining matches are cancelled, your opponents are told, and you leave the standings. You can't rejoin this season."
        : "You can rejoin with the invite code until the season starts.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave league",
          style: "destructive",
          onPress: () =>
            leave
              .mutateAsync({ leagueId })
              .then(async () => {
                await Promise.all(
                  [
                    getGetLeagueMembershipQueryKey(leagueId),
                    getGetLeagueQueryKey(leagueId),
                    getGetLeagueScheduleQueryKey(leagueId),
                    getGetLeagueStandingsQueryKey(leagueId),
                    getGetLeaguesQueryKey().slice(0, 1),
                    getGetMyPlayersQueryKey(),
                  ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
                );
                AccessibilityInfo.announceForAccessibility(`You left ${league.name}`);
                router.back();
              })
              .catch((e) =>
                Alert.alert(
                  "Couldn't leave the league",
                  (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.",
                ),
              ),
        },
      ],
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.ink} />}
    >
      {/* Admin tools appear in context only (spec: Roles). */}
      <Stack.Screen
        options={{
          headerRight: membershipQ.data?.isAdmin
            ? () => (
                <IconButton symbol="slider.horizontal.3" label="Manage" onPress={() => router.push(`/league/${leagueId}/manage`)} />
              )
            : undefined,
        }}
      />
      {leagueQ.isError || !league ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">Couldn't load this league</Text>
          <Text variant="small" tone="inkMuted">
            Pull down to try again.
          </Text>
        </Card>
      ) : (
        <>
          <View style={{ gap: spacing.space1 }}>
            <Text variant="label" tone="inkMuted">
              {eyebrow}
            </Text>
            <Text variant="displayL" accessibilityRole="header">
              {league.name}
            </Text>
            <Text variant="small" tone="inkMuted">
              {[playersLabel(league.playerCount), season].filter(Boolean).join(" · ")}
            </Text>
          </View>

          {playoff ? (
            <Card style={{ gap: spacing.space3 }}>
              <View
                accessible
                accessibilityLabel={`Your ${ROUND_SINGULAR[playoff.slot.round].toLowerCase()}. You versus ${playoff.opponent?.playerName ?? "to be decided"}.`}
                style={{ gap: spacing.space1 }}
              >
                <Text variant="label" tone="inkMuted">
                  {`Playoffs · ${ROUND_SINGULAR[playoff.slot.round]}`}
                </Text>
                <Text variant="title">{`You vs. ${playoff.opponent?.playerName ?? "to be decided"}`}</Text>
              </View>
              <Button
                label="Enter score"
                accessibilityHint={`For your ${ROUND_SINGULAR[playoff.slot.round].toLowerCase()}`}
                onPress={() => router.push(`/league/${leagueId}/score/${playoff.slot.matchId}`)}
              />
            </Card>
          ) : week && myPlayerId != null ? (
            <YourWeek leagueId={leagueId} week={week} myPlayerId={myPlayerId} />
          ) : null}

          {draft && membershipQ.data?.isAdmin ? (
            <Card style={{ gap: spacing.space3 }}>
              <View accessible style={{ gap: spacing.space1 }}>
                <Text variant="label" tone="inkMuted">
                  Admin
                </Text>
                <Text variant="bodyStrong">{`Round ${draft.roundNumber} pairings are ready to review`}</Text>
                <Text variant="small" tone="inkMuted">
                  {`They go out to players ${shortDate(draft.startDate)} at 7am.`}
                </Text>
              </View>
              <Button label="Review pairings" variant="secondary" onPress={() => router.push(`/league/${leagueId}/round/${draft.roundId}`)} />
            </Card>
          ) : null}

          <SegmentedTabs
            label="League sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "standings", label: "Standings" },
              { value: "rounds", label: "Rounds" },
              { value: "playoffs", label: "Playoffs" },
            ]}
          />

          {tab === "standings" ? (
            <View style={{ gap: spacing.space2 }}>
              {standingsQ.isLoading ? (
                <ActivityIndicator color={c.ink} accessibilityLabel="Loading standings" />
              ) : standings.length === 0 ? (
                <Card>
                  <Text tone="inkMuted">Standings show up here after the first scores are in.</Text>
                </Card>
              ) : (
                <StandingsTable standings={standings} myPlayerId={myPlayerId} />
              )}
              <Text variant="small" tone="inkMuted">
                {`Ranked on wins. Players with the same wins share a rank.${
                  league.playoffSize ? ` Top ${league.playoffSize} make the playoffs.` : ""
                }`}
              </Text>
            </View>
          ) : null}

          {tab === "rounds" ? (
            <View style={{ gap: spacing.space3 }}>
              {scheduleQ.isLoading ? (
                <ActivityIndicator color={c.ink} accessibilityLabel="Loading rounds" />
              ) : rounds.length === 0 && (schedule?.upcoming.length ?? 0) === 0 ? (
                <Card>
                  <Text tone="inkMuted">
                    {league.startDate
                      ? `Pairings go out each week starting ${shortDate(league.startDate)}.`
                      : "Rounds show up here once pairings go out."}
                  </Text>
                </Card>
              ) : (
                <>
                  {rounds.map((r) => (
                    <RoundCard key={r.roundId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} />
                  ))}
                  {schedule && schedule.upcoming.length > 0 ? (
                    <View style={{ gap: spacing.space2 }}>
                      <Text variant="label" tone="inkMuted" accessibilityRole="header">
                        Later this season
                      </Text>
                      <Card style={{ padding: 0, overflow: "hidden" }}>
                        {schedule.upcoming.map((w, i) => (
                          <UpcomingWeekRow key={w.roundNumber} week={w} last={i === schedule.upcoming.length - 1} />
                        ))}
                      </Card>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {tab === "playoffs" && bracket ? (
            <BracketView bracket={bracket} myPlayerId={myPlayerId} onEnterScore={(id) => router.push(`/league/${leagueId}/score/${id}`)} />
          ) : null}

          {tab === "playoffs" && !bracket ? (
            <Card style={{ gap: spacing.space2 }}>
              {league.playoffSize ? (
                <>
                  <Text variant="bodyStrong">{`Top ${league.playoffSize} make the playoffs`}</Text>
                  <Text tone="inkMuted">
                    {league.endDate
                      ? `Seeds are set from the standings the day after the regular season ends ${shortDate(league.endDate)}. Ties on wins go to head-to-head, then sets, then games.`
                      : "Seeds are set from the standings after the regular season."}
                  </Text>
                </>
              ) : (
                <Text tone="inkMuted">This league doesn't have playoffs this season.</Text>
              )}
            </Card>
          ) : null}

          {membershipQ.data?.isPlaying && league.status !== "completed" ? (
            <Button
              label="Leave league"
              variant="destructive"
              loading={leave.isPending}
              onPress={confirmLeave}
              style={{ marginTop: spacing.space6 }}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
