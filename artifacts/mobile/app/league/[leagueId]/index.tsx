import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
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
import { UndoScore } from "@/components/league/UndoScore";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { IconButton } from "@/components/Choice";
import { StandingsTable } from "@/components/league/StandingsTable";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { RatingBadge } from "@/components/RatingBadge";
import { formatRating } from "@/lib/onboarding";
import { canEnterScore, correctionLine, dateRange, myWeek, opponentName, resultLine, shortDate } from "@/lib/leagueSchedule";
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
  const opponentId = match.player1Id === myPlayerId ? match.player2Id : match.player1Id;
  const opponentRating = match.player1Id === myPlayerId ? match.player2Rating : match.player1Rating;
  const canMessage = match.player1Id === myPlayerId ? match.player2HasAccount : match.player1HasAccount;
  const scoreable = canEnterScore(round, match);
  const { fontScale } = useWindowDimensions();
  // C7: a direct chat with your opponent. League mates skip Message Requests.
  const message = () =>
    router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(opponentId), name: opponent } });
  const played = match.status === "completed" && !!match.score;
  const corrected = correctionLine(match);
  // After an undo, the opponent sees who cleared it until a new score is in.
  const clearedNote = !played && match.scoreClearedBy ? `Score cleared by ${match.scoreClearedBy}. ` : "";
  const when = played
    ? [resultLine(match), corrected].filter(Boolean).join(". ")
    : clearedNote +
      (round.phase === "upcoming"
      ? `Starts ${shortDate(round.startDate)}. Play by ${shortDate(round.deadline)}.`
      : round.phase === "grace"
        ? `Grace week until ${shortDate(round.graceEnd)}. A score now counts for Ball Boi stats, not standings.`
        : `Play by ${shortDate(round.deadline)}.`);

  return (
    <Card style={{ gap: spacing.space3 }}>
      <View
        accessible
        accessibilityLabel={`Your match. ${label}. You versus ${opponent}${
          opponentRating ? `, Ball Boi Rating ${formatRating(opponentRating.rating)}, ${opponentRating.source === "verified" ? "Verified" : "Self-rated"}` : ""
        }. ${when}`}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="label" tone="inkMuted">
          {label}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title">{`You vs. ${opponent}`}</Text>
          {opponentRating ? <RatingBadge rating={opponentRating.rating} source={opponentRating.source} /> : null}
        </View>
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
      </View>
      {/* Side by side; stacked at large text sizes so neither label truncates. */}
      <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: spacing.space2 }}>
        {scoreable ? (
          <Button
            label="Enter score"
            accessibilityHint={`For your match against ${opponent}`}
            onPress={() => router.push(`/league/${leagueId}/score/${match.matchId}`)}
            style={fontScale >= 1.3 ? undefined : { flex: 1 }}
          />
        ) : null}
        {canMessage ? (
          <Button
            label={`Message ${opponent.split(" ")[0]}`}
            accessibilityLabel={`Message ${opponent}`}
            accessibilityHint="Opens a direct chat"
            variant="secondary"
            onPress={message}
            style={fontScale >= 1.3 ? undefined : { flex: 1 }}
          />
        ) : null}
      </View>
      {!scoreable ? <UndoScore leagueId={leagueId} matchId={match.matchId} undoUntil={match.undoUntil} align="flex-start" /> : null}
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
  const ended = !!league?.endedAt;
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;

  // Dropouts (decision 27): played matches stay, the rest are cancelled.
  function confirmLeave() {
    if (!league) return;
    // C8: the only admin hands the league on first.
    if (membershipQ.data?.onlyAdmin) {
      Alert.alert("Make someone a co-admin first", `You're the only admin of ${league.name}. Make another player a co-admin in Manage, then you can leave.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Open Manage", onPress: () => router.push(`/league/${leagueId}/manage`) },
      ]);
      return;
    }
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
            <Text variant="brushL" accessibilityRole="header">
              {league.name}
            </Text>
            <Text variant="small" tone="inkMuted">
              {[playersLabel(league.playerCount), season].filter(Boolean).join(" · ")}
            </Text>
            {/* A late joiner starts at zero wins and enters the next round (C3). */}
            {membershipQ.data?.joinedWeek && membershipQ.data.seasonWeeks && league.status !== "completed" ? (
              <Text variant="small" tone="inkMuted">
                {`You joined in week ${membershipQ.data.joinedWeek} of ${membershipQ.data.seasonWeeks}.`}
              </Text>
            ) : null}
          </View>

          {ended ? (
            // Decision 31: an admin ended the league. Standings are final.
            <Card accessible style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
              <SymbolView name="flag.checkered" size={20} tintColor={c.ink} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">This league has ended</Text>
                <Text variant="small" tone="inkMuted">
                  {`Standings are final as of ${new Date(league.endedAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Everything played stays.`}
                </Text>
              </View>
            </Card>
          ) : playoff ? (
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
                    <RoundCard key={r.roundId} leagueId={leagueId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} frozen={ended} />
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
