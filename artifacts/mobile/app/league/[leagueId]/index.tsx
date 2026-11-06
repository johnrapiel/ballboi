import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetLeague,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useLeaveLeague,
  useGetLeagueSchedule,
  useGetLeagueStandings,
  useSettlePlayoffMatch,
  type BracketSlot,
  type ScheduleMatch,
} from "@workspace/api-client-react";

import { RoundCard, UpcomingWeekRow } from "@/components/league/RoundCard";
import { UndoScore } from "@/components/league/UndoScore";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { IconButton } from "@/components/Choice";
import { StandingsTable } from "@/components/league/StandingsTable";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { RatingBadge } from "@/components/RatingBadge";
import { levelSpoken } from "@/lib/onboarding";
import {
  canEnterScore,
  correctionLine,
  dateRange,
  deadlineDate,
  matchWhen,
  firstNames,
  myWeek,
  opponentName,
  pairingTime,
  partnerOf,
  playoffLine,
  resultLine,
  shortDate,
  weeklyMatchTime,
} from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { formatLabel, playersLabel, playTypeLabel } from "@/lib/leagues";

// League (spec: Leagues; canvas: League · Standings, Rounds, Playoffs).
// Your match this week sits on top, then Standings, Rounds, and Playoffs.

type Tab = "standings" | "rounds" | "playoffs";

/**
 * PR 4: the match's date and time. A row that opens the Match time sheet when
 * you can set it (leagues with no weekly time, or admins); plain text otherwise.
 */
function MatchTimeRow({ when, canSet, onPress }: { when: string | null; canSet: boolean; onPress: () => void }) {
  const c = useColors();
  const value = when ?? "Not set";
  if (!canSet) {
    return when ? (
      <View accessible accessibilityLabel={`Match time, ${when}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        <SymbolView name="calendar" size={16} tintColor={c.inkMuted} />
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
      </View>
    ) : null;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Match time, ${value}`}
      accessibilityHint={when ? "Change the day and time" : "Pick a day and time this week"}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        borderTopWidth: 1,
        borderTopColor: c.hairline,
        paddingTop: spacing.space2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name="calendar" size={18} tintColor={c.ink} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        Match time
      </Text>
      <Text variant="small" tone="inkMuted">
        {when ? value : "Set a time"}
      </Text>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}

function YourWeek({
  leagueId,
  week,
  myPlayerId,
  timeZone,
  canSetTime,
  ended,
}: {
  leagueId: number;
  week: NonNullable<ReturnType<typeof myWeek>>;
  myPlayerId: number;
  timeZone: string | null;
  canSetTime: boolean;
  ended: boolean;
}) {
  // C6: hooks before any early return, so a bye week turning into a match
  // doesn't change the hook order.
  const { fontScale } = useWindowDimensions();
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
  // Doubles (Wave 2): you and your partner against two opponents.
  const partner = partnerOf(match, myPlayerId);
  const matchup = partner ? `You and ${partner.name} vs. ${opponent}` : `You vs. ${opponent}`;
  const opponentId = match.player1Id === myPlayerId ? match.player2Id : match.player1Id;
  const opponentRating = partner ? null : match.player1Id === myPlayerId ? match.player2Rating : match.player1Rating;
  const scoreable = canEnterScore(round, match, ended);
  // C7: a direct chat with your opponent. League mates skip Message Requests.
  // In doubles, pick who to message: your partner or either opponent.
  const others = (
    [
      [match.player1Id, match.player1Name, match.player1HasAccount],
      [match.player2Id, match.player2Name, match.player2HasAccount],
      [match.player3Id, match.player3Name, match.player3HasAccount],
      [match.player4Id, match.player4Name, match.player4HasAccount],
    ] as const
  )
    .filter(([id, , hasAccount]) => id != null && id !== myPlayerId && hasAccount)
    .map(([id, name]) => ({ playerId: id!, name: name ?? "Player" }));
  const canMessage = partner ? others.length > 0 : match.player1Id === myPlayerId ? match.player2HasAccount : match.player1HasAccount;
  const openChat = (playerId: number, name: string) =>
    router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(playerId), name } });
  const message = () => {
    if (!partner) return openChat(opponentId, opponent);
    const options = [...others.map((o) => o.name), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ title: "Message", options, cancelButtonIndex: options.length - 1 }, (i) => {
      const o = others[i];
      if (o) openChat(o.playerId, o.name);
    });
  };
  const played = match.status === "completed" && !!match.score;
  const corrected = correctionLine(match);
  // After an undo, the opponent sees who cleared it until a new score is in.
  const clearedNote = !played && match.scoreClearedBy ? `Score cleared by ${match.scoreClearedBy}. ` : "";
  const when = played
    ? [resultLine(match, round, ended), corrected].filter(Boolean).join(". ")
    : clearedNote +
      (round.phase === "upcoming"
      ? `Starts ${shortDate(round.startDate)}. Play by ${deadlineDate(round.deadline, timeZone)}.`
      : round.phase === "grace"
        ? `Grace week until ${deadlineDate(round.graceEnd, timeZone)}. A score now counts for Ball Boi stats, not standings.`
        : `Play by ${deadlineDate(round.deadline, timeZone)}.`);
  const matchTime = matchWhen(match.scheduledAt);

  return (
    <Card style={{ gap: spacing.space3 }}>
      <View
        accessible
        accessibilityLabel={`Your match. ${label}. ${matchup.replace(" vs. ", " versus ")}${
          opponentRating ? `, ${levelSpoken(opponentRating.rating, opponentRating.source)}` : ""
        }. ${when}`}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="label" tone="inkMuted">
          {label}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title">{matchup}</Text>
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
            label={partner ? "Message" : `Message ${firstNames(opponent)}`}
            accessibilityLabel={partner ? "Message a player in this match" : `Message ${opponent}`}
            accessibilityHint={partner ? "Pick your partner or an opponent for a direct chat" : "Opens a direct chat"}
            variant="secondary"
            onPress={message}
            style={fontScale >= 1.3 ? undefined : { flex: 1 }}
          />
        ) : null}
      </View>
      {!scoreable ? <UndoScore leagueId={leagueId} matchId={match.matchId} undoUntil={match.undoUntil} align="flex-start" /> : null}
      {!played && !match.voided && round.phase !== "closed" && !ended ? (
        <MatchTimeRow
          when={matchTime}
          canSet={canSetTime && scoreable}
          onPress={() => router.push(`/league/${leagueId}/time/${match.matchId}`)}
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
  const settle = useSettlePlayoffMatch();

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
    ? [formatLabel(league.format), playTypeLabel(league.leagueType, league.partnerMode), league.location].filter(Boolean).join(" · ")
    : "";
  const season =
    league?.startDate && league.endDate ? `Season ${dateRange(league.startDate, league.endDate)}` : null;

  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  // An admin ended it (decision 31), or the season finished. Scores are final (Q9).
  const ended = !!league?.endedAt || league?.status === "completed";
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;
  const isAdmin = !!membershipQ.data?.isAdmin;
  const playoffsNote = league ? playoffLine(league.playoffSize, league.playerCount) : null;

  // Dropouts (decision 27): played matches stay, the rest are cancelled.
  // Q4: an admin who leaves stops playing but still manages the league.
  function confirmLeave() {
    if (!league) return;
    const matchesNote = started
      ? "Your played matches stay. Your remaining matches are cancelled, your opponents are told, and you leave the standings."
      : null;
    const message = isAdmin
      ? ["You'll stop playing but still manage this league.", matchesNote].filter(Boolean).join(" ")
      : started
        ? `${matchesNote} To come back, you'll need the admin to approve you.`
        : "You can rejoin with the invite code until the season starts.";
    Alert.alert(
      `Leave ${league.name}?`,
      message,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave league",
          style: "destructive",
          onPress: () =>
            leave
              .mutateAsync({ leagueId })
              .then(async (out) => {
                await refreshLeague(queryClient, leagueId);
                AccessibilityInfo.announceForAccessibility(`You left ${league.name}`);
                // An admin stays on the league to keep managing it.
                if (!(out.stillAdmin ?? isAdmin)) router.back();
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

  // Q5b: after a playoff round's play-by date, the admin enters the result.
  function settlePlayoff(slot: BracketSlot) {
    if (slot.matchId == null || !slot.player1 || !slot.player2) return;
    const matchId = slot.matchId;
    const walkover = (winner: NonNullable<BracketSlot["player1"]>) =>
      settle
        .mutateAsync({ leagueId, matchId, data: { walkoverWinnerId: winner.playerId } })
        .then(async () => {
          await refreshLeague(queryClient, leagueId);
          AccessibilityInfo.announceForAccessibility(`${winner.playerName} moves on by walkover`);
        })
        .catch((e) =>
          Alert.alert("Couldn't enter the result", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."),
        );
    Alert.alert(`${slot.player1.playerName} vs. ${slot.player2.playerName}`, "The play-by date has passed. Enter the score, or give one player a walkover (W/O).", [
      { text: "Enter score", onPress: () => router.push(`/league/${leagueId}/score/${matchId}?settle=1`) },
      { text: `Walkover to ${slot.player1.playerName}`, onPress: () => void walkover(slot.player1!) },
      { text: `Walkover to ${slot.player2.playerName}`, onPress: () => void walkover(slot.player2!) },
      { text: "Cancel", style: "cancel" },
    ]);
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
          headerRight: isAdmin
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
            {weeklyMatchTime(league.matchDay, league.matchTime, league.timeZone) ? (
              <Text variant="small" tone="inkMuted">
                {`Matches ${weeklyMatchTime(league.matchDay, league.matchTime, league.timeZone)}`}
              </Text>
            ) : null}
            {/* A late joiner starts at zero wins and enters the next round (C3). */}
            {membershipQ.data?.joinedWeek && membershipQ.data.seasonWeeks && league.status !== "completed" ? (
              <Text variant="small" tone="inkMuted">
                {`You joined in week ${membershipQ.data.joinedWeek} of ${membershipQ.data.seasonWeeks}.`}
              </Text>
            ) : null}
          </View>

          {ended ? (
            // Decision 31: an admin ended the league, or the season finished. Standings are final.
            <Card accessible style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
              <SymbolView name="flag.checkered" size={20} tintColor={c.ink} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">This league has ended</Text>
                <Text variant="small" tone="inkMuted">
                  {league.endedAt
                    ? `Standings are final as of ${new Date(league.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Everything played stays.`
                    : "Standings are final. Everything played stays."}
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
                {playoff.playBy ? (
                  <Text variant="small" tone="inkMuted">
                    {playoff.pastPlayBy
                      ? `The play-by date was ${deadlineDate(playoff.playBy, schedule?.timeZone)}. Your league admin can enter the result.`
                      : `Play by ${deadlineDate(playoff.playBy, schedule?.timeZone)}.`}
                  </Text>
                ) : null}
              </View>
              {!playoff.pastPlayBy ? (
                <Button
                  label="Enter score"
                  accessibilityHint={`For your ${ROUND_SINGULAR[playoff.slot.round].toLowerCase()}`}
                  onPress={() => router.push(`/league/${leagueId}/score/${playoff.slot.matchId}`)}
                />
              ) : null}
            </Card>
          ) : week && myPlayerId != null ? (
            <YourWeek
              leagueId={leagueId}
              week={week}
              myPlayerId={myPlayerId}
              timeZone={schedule?.timeZone ?? null}
              canSetTime={league?.matchDay == null || !!schedule?.isAdmin}
              ended={ended}
            />
          ) : null}

          {draft && isAdmin && !ended ? (
            <Card style={{ gap: spacing.space3 }}>
              <View accessible style={{ gap: spacing.space1 }}>
                <Text variant="label" tone="inkMuted">
                  Admin
                </Text>
                <Text variant="bodyStrong">{`Round ${draft.roundNumber} pairings are ready to review`}</Text>
                <Text variant="small" tone="inkMuted">
                  {`They go out to players ${shortDate(draft.startDate)} at ${pairingTime(schedule?.timeZone)}.`}
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
                {`Ranked on wins. Players with the same wins share a rank.${playoffsNote ? ` ${playoffsNote}` : ""}`}
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
                    <RoundCard key={r.roundId} leagueId={leagueId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} ended={ended} timeZone={schedule?.timeZone} />
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
            <BracketView
              bracket={bracket}
              myPlayerId={myPlayerId}
              onEnterScore={(id) => router.push(`/league/${leagueId}/score/${id}`)}
              onSettle={settlePlayoff}
              isAdmin={isAdmin}
              ended={ended}
              timeZone={schedule?.timeZone}
            />
          ) : null}

          {tab === "playoffs" && !bracket ? (
            <Card style={{ gap: spacing.space2 }}>
              {league.playoffSize && league.playerCount < 4 ? (
                // C21: a bracket needs at least 4 players.
                <Text tone="inkMuted">Not enough players for playoffs this season.</Text>
              ) : league.playoffSize ? (
                <>
                  <Text variant="bodyStrong">{(playoffsNote ?? "").replace(/\.$/, "")}</Text>
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


          {membershipQ.data?.isPlaying && !ended ? (
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
