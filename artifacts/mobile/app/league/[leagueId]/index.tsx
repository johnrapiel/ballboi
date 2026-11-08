import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/components/Icon";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
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
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { ListRow } from "@/components/league/ListRow";
import { StandingsTable } from "@/components/league/StandingsTable";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { RatingBadge } from "@/components/RatingBadge";
import { DoublesRecordButton } from "@/components/record/DoublesMatchCard";
import { levelSpoken } from "@/lib/onboarding";
import {
  canEnterScore,
  correctionLine,
  editedLine,
  dateRange,
  deadlineDate,
  matchWhen,
  myWeek,
  opponentName,
  pairingTime,
  playoffLine,
  recordAction,
  resultLine,
  shortDate,
  weeklyMatchTime,
} from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { formatLabel, playersLabel, playTypeLabel } from "@/lib/leagues";
import { openRecorder } from "@/lib/recording/start";

// League (spec: Leagues; approved canvas: League detail · Standings). A brush
// title and one meta line, then your match this week, then Standings, Matches
// and Playoffs. Admins get a visible Manage league row (John, Nov 6, finding
// 8) instead of a header icon, with the "Round N pairings are ready to
// review" card directly under it, above your match (finding 29). The invite
// (code, copy, share) lives in Manage league now (finding 29). Players see
// neither.

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
        <Icon name="calendar" size={16} tintColor={c.inkMuted} />
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
      <Icon name="calendar" size={18} tintColor={c.ink} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        Match time
      </Text>
      <Text variant="small" tone="inkMuted">
        {when ? value : "Set a time"}
      </Text>
      <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
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
  doubles,
}: {
  leagueId: number;
  week: NonNullable<ReturnType<typeof myWeek>>;
  myPlayerId: number;
  timeZone: string | null;
  canSetTime: boolean;
  ended: boolean;
  /** A doubles league's match: Record shows dimmed with the reason. */
  doubles: boolean;
}) {
  // C6: hooks before any early return, so a bye week turning into a match
  // doesn't change the hook order.
  const { fontScale } = useWindowDimensions();
  const { round, match, bye } = week;
  const label = `Round ${round.roundNumber} · ${dateRange(round.startDate, round.deadline)}`;

  if (bye) {
    return (
      <Card accessible accessibilityLabel={`${label}. You have a bye this week.`} style={{ gap: spacing.space1 }}>
        <Text variant="section" tone="inkMuted">
          {label}
        </Text>
        <Text variant="title">You have a bye this week.</Text>
      </Card>
    );
  }
  if (!match) return null;

  const opponent = opponentName(match, myPlayerId);
  const opponentId = match.player1Id === myPlayerId ? match.player2Id : match.player1Id;
  const opponentRating = match.player1Id === myPlayerId ? match.player2Rating : match.player1Rating;
  const canMessage = match.player1Id === myPlayerId ? match.player2HasAccount : match.player1HasAccount;
  const scoreable = canEnterScore(round, match, ended);
  const record = recordAction(round, match, ended, doubles);
  const stack = fontScale >= 1.3;
  // C7: a direct chat with your opponent.
  const message = () =>
    router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(opponentId), name: opponent } });
  const played = match.status === "completed" && !!match.score;
  const corrected = correctionLine(match) ?? editedLine(match);
  // Older matches only: before the 24-hour edit, an undo left who cleared it.
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
        accessibilityLabel={`Your match. ${label}. You versus ${opponent}${
          opponentRating ? `, ${levelSpoken(opponentRating.rating, opponentRating.source)}` : ""
        }. ${when}`}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="section" tone="inkMuted">
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
      {/* John, Nov 8 (option A): Record with Ball Boi is the one primary
          action any day of the match's week, with Enter score and Message
          under it (spec: Ball Boi > Recording, "Every recording starts from
          a match"). Doubles shows it dimmed with the reason as visible text. */}
      {record === "record" ? (
        <Button
          label="Record with Ball Boi"
          accessibilityHint={`Records your match against ${opponent}`}
          onPress={() => openRecorder(router, { matchId: match.matchId, opponentName: opponent, leagueId })}
        />
      ) : record === "doubles" ? (
        <DoublesRecordButton matchId={match.matchId} />
      ) : null}
      {/* Side by side; stacked at large text sizes so neither label truncates. */}
      {scoreable || canMessage ? (
        <View style={{ flexDirection: stack ? "column" : "row", gap: spacing.space2 }}>
          {scoreable ? (
            <Button
              label="Enter score"
              accessibilityHint={`For your match against ${opponent}`}
              // Under Record it steps back to secondary; on its own it stays primary.
              variant={record ? "secondary" : "primary"}
              onPress={() => router.push(`/league/${leagueId}/score/${match.matchId}`)}
              style={stack ? undefined : { flex: 1 }}
            />
          ) : null}
          {canMessage ? (
            <Button
              label={`Message ${opponent.split(" ")[0]}`}
              accessibilityLabel={`Message ${opponent}`}
              accessibilityHint="Opens a direct chat"
              variant="secondary"
              onPress={message}
              style={stack ? undefined : { flex: 1 }}
            />
          ) : null}
        </View>
      ) : null}
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

  const meta = league
    ? [formatLabel(league.format), playTypeLabel(league.leagueType), league.location].filter(Boolean).join(" · ")
    : "";
  const season =
    league?.startDate && league.endDate ? `Season ${dateRange(league.startDate, league.endDate)}` : null;

  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  // An admin ended it (decision 31), or the season finished. Scores are final (Q9).
  const ended = !!league?.endedAt || league?.status === "completed";
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;
  const isAdmin = !!membershipQ.data?.isAdmin;
  // Q2: doubles leagues don't run yet. One made before then says so.
  const doublesOnHold = league?.leagueType === "doubles" && !ended;
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
            <Text variant="headingM" accessibilityRole="header">
              {league.name}
            </Text>
            {meta ? (
              <Text variant="small" tone="inkMuted">
                {meta}
              </Text>
            ) : null}
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

          {isAdmin ? (
            // Admin tools in context only (spec: Roles), as a visible row (finding 8).
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <ListRow
                title="Manage league"
                subtitle="Invite code, pairings, players and admins"
                symbol="slider.horizontal.3"
                onPress={() => router.push(`/league/${leagueId}/manage`)}
                accessibilityHint="Opens the admin tools for this league"
                last
              />
            </Card>
          ) : null}

          {/* Finding 29: right under Manage league, above your match. */}
          {draft && isAdmin && !ended ? (
            <Card style={{ gap: spacing.space3 }}>
              <View accessible style={{ gap: spacing.space1 }}>
                <Text variant="section" tone="inkMuted">
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

          {ended ? (
            // Decision 31: an admin ended the league, or the season finished. Standings are final.
            <Card accessible style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
              <Icon name="flag.checkered" size={20} tintColor={c.ink} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">This league has ended</Text>
                <Text variant="small" tone="inkMuted">
                  {league.endedAt
                    ? `Standings are final as of ${new Date(league.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Everything played stays.`
                    : "Standings are final. Everything played stays."}
                </Text>
              </View>
            </Card>
          ) : doublesOnHold ? (
            <Card accessible style={{ gap: spacing.space1 }}>
              <Text variant="bodyStrong">This doubles league isn't running yet</Text>
              <Text variant="small" tone="inkMuted">
                Weekly pairings are for singles leagues for now. Your league and its players are saved.
              </Text>
            </Card>
          ) : playoff ? (
            <Card style={{ gap: spacing.space3 }}>
              <View
                accessible
                accessibilityLabel={`Your ${ROUND_SINGULAR[playoff.slot.round].toLowerCase()}. You versus ${playoff.opponent?.playerName ?? "to be decided"}.`}
                style={{ gap: spacing.space1 }}
              >
                <Text variant="section" tone="inkMuted">
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
              doubles={league?.leagueType === "doubles"}
            />
          ) : null}

          {doublesOnHold ? null : (
          <>
          <SegmentedTabs
            label="League sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "standings", label: "Standings" },
              { value: "rounds", label: "Matches" },
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
                {`Ranked by wins, then head to head.${playoffsNote ? ` ${playoffsNote}` : ""}`}
              </Text>
            </View>
          ) : null}

          {tab === "rounds" ? (
            <View style={{ gap: spacing.space3 }}>
              {scheduleQ.isLoading ? (
                <ActivityIndicator color={c.ink} accessibilityLabel="Loading matches" />
              ) : rounds.length === 0 && (schedule?.upcoming.length ?? 0) === 0 ? (
                <Card>
                  <Text tone="inkMuted">
                    {league.startDate
                      ? `Pairings go out each week starting ${shortDate(league.startDate)}.`
                      : "Matches show up here once pairings go out."}
                  </Text>
                </Card>
              ) : (
                <>
                  {rounds.map((r) => (
                    <RoundCard key={r.roundId} leagueId={leagueId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} ended={ended} timeZone={schedule?.timeZone} />
                  ))}
                  {schedule && schedule.upcoming.length > 0 ? (
                    <View style={{ gap: spacing.space2 }}>
                      <Text variant="section" tone="inkMuted" accessibilityRole="header">
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

          </>
          )}

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
