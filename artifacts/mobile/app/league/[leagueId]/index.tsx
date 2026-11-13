import { router, useLocalSearchParams } from "expo-router";
import { useActionSheet } from "@/components/ActionSheet";
import { Icon } from "@/components/Icon";
import { areaLabel } from "@/lib/leagueArea";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  useGetLeague,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useLeaveLeague,
  useGetLeagueSchedule,
  useGetLeagueStandings,
  useOpenDoublesMatchChat,
  useSettlePlayoffMatch,
  type BracketSlot,
  type ScheduleMatch,
} from "@workspace/api-client-react";

import { LeagueChatButton } from "@/components/league/LeagueChatButton";
import { MatchTimeLink } from "@/components/MatchTimeLink";
import { ProblemCard } from "@/components/discover/States";
import { OfflineNotice } from "@/components/OfflineNotice";
import { TeamUpRequestCards } from "@/components/league/PartnerCard";
import { PairingsLine, PartnerLine } from "@/components/league/LeagueLines";
import { JoinedNote } from "@/components/league/JoinedNote";
import { CornerButton } from "@/components/CornerButton";
import { LeaveAction } from "@/components/LeaveAction";
import { andJoin, isDoublesMatch, manageLeagueLabel, opponentNames, partnerName, versusLine, versusSpoken } from "@/lib/doubles";
import { RoundCard, UpcomingWeekRow } from "@/components/league/RoundCard";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { StandingsTable } from "@/components/league/StandingsTable";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, ButtonRow, Card, Text, TextLinkButton } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
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
  playoffLine,
  recordAction,
  resultLine,
  LATE_NOTE,
  lateTime,
  playByLine,
  shortDate,
  weeklyMatchTime,
} from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { formatLabel, playersLabel, playTypeLabel } from "@/lib/leagues";
import { isPastDue, pastDueWhen } from "@/lib/matchTiming";
import { openRecorder } from "@/lib/recording/start";

// League (spec: Leagues; approved canvas: League detail · Standings). One
// main card, your match (finding 31, decision 185, John, Nov 12). Top to
// bottom:
// - The name and info lines, with the chat corner button and, for admins, a
//   gear corner button just left of it that opens Manage league. The gear
//   has an ink dot while a round's pairings wait for review.
// - Fixed-partner doubles: your partner as one line, or "No partner yet ·
//   Team up" (opens the Team up sheet).
// - Admins, when pairings wait: "Round N pairings are ready." and Review.
// - A team-up request to you, as a card only while it waits.
// - Your match this week, then Standings, Matches and Playoffs.
// - Leave league, quiet text at the bottom (decision 184).

type Tab = "standings" | "rounds" | "playoffs";

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
  const c = useColors();
  const openChat = useOpenDoublesMatchChat();
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

  // Doubles (D6, D8): "You and Sam vs. Jo and Lee", and Message opens one chat for all four.
  const isDoubles = isDoublesMatch(match);
  const partner = isDoubles ? partnerName(match, myPlayerId) : null;
  const others = isDoubles ? opponentNames(match, myPlayerId) : [];
  const opponent = opponentName(match, myPlayerId);
  const opponentId = match.player1Id === myPlayerId ? match.player2Id : match.player1Id;
  const opponentRating = isDoubles ? null : match.player1Id === myPlayerId ? match.player2Rating : match.player1Rating;
  const canMessage = isDoubles || (match.player1Id === myPlayerId ? match.player2HasAccount : match.player1HasAccount);
  const scoreable = canEnterScore(round, match, ended);
  const recordable = recordAction(round, match, ended, doubles);
  // Finding 47: an hour past the set start with no score, Enter score leads and
  // Record with Ball Boi is a text link (in case they're still playing). Doubles
  // has nothing to record yet, so its dimmed Record steps away.
  const pastDue = scoreable && isPastDue({ scheduledAt: match.scheduledAt, score: match.score, timeZone });
  const record = pastDue ? null : recordable;
  // C7: a direct chat with your opponent.
  const message = () => {
    if (!isDoubles) {
      router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(opponentId), name: opponent } });
      return;
    }
    openChat
      .mutateAsync({ leagueId, matchId: match.matchId })
      .then(({ groupId }) => router.push({ pathname: "/conversation/group/[id]", params: { id: String(groupId) } }))
      .catch((e) => Alert.alert("Couldn't open the chat", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."));
  };
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
        ? `${playByLine(round.graceEnd, timeZone)}. ${LATE_NOTE}`
        : `Play by ${deadlineDate(round.deadline, timeZone)}.`);
  // A late match keeps its saved time only while that's still ahead (decision 152).
  const matchTime = matchWhen(round.phase === "grace" ? lateTime(match.scheduledAt) : match.scheduledAt);
  // Wave 2 finding 25 (John, Nov 12): the time sits under the date line, and
  // "Set a match time" or "Change time" is link text right below it, as on
  // Match detail. No Match time row under the buttons.
  const timeOpen = !played && !match.voided && round.phase !== "closed" && !ended;
  // Past due, the time reads "Earlier today · 6:30 PM" (finding 47).
  const shownTime = timeOpen ? (pastDue && match.scheduledAt ? pastDueWhen(match.scheduledAt) : matchTime) : null;
  const canSetThisTime = timeOpen && canSetTime && scoreable;

  return (
    <Card style={{ gap: spacing.space3 }}>
      <View
        accessible
        accessibilityLabel={`Your match. ${label}. ${isDoubles ? versusSpoken(partner, others) : `You versus ${opponent}`}${
          opponentRating ? `, ${levelSpoken(opponentRating.rating, opponentRating.source)}` : ""
        }. ${when}${shownTime ? ` Match time, ${shownTime}.` : ""}`.replace(/ & /g, " and ")}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="section" tone="inkMuted">
          {label}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title">{isDoubles ? versusLine(partner, others) : `You vs. ${opponent}`}</Text>
          {opponentRating ? <RatingBadge rating={opponentRating.rating} source={opponentRating.source} /> : null}
        </View>
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
        {shownTime ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
            <Icon name="calendar" size={16} tintColor={c.inkMuted} />
            <Text variant="small" tone="inkMuted" style={{ flexShrink: 1 }}>
              {shownTime}
            </Text>
          </View>
        ) : null}
      </View>
      {canSetThisTime ? (
        <MatchTimeLink
          align="left"
          hasTime={!!matchTime}
          opponent={isDoubles ? andJoin(others) : opponent}
          onPress={() => router.push(`/league/${leagueId}/time/${match.matchId}`)}
          // Sits right under the date line; its 44pt target is hitSlop (decision 192).
        />
      ) : null}
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
      {/* Side by side at one height; ButtonRow stacks them when a label
          wouldn't fit on one line (John, Nov 10). The visible word is just
          "Message" so the pair fits; VoiceOver still names who (option A). */}
      {scoreable || canMessage ? (
        <ButtonRow>
          {scoreable ? (
            <Button
              label="Enter score"
              accessibilityHint={`For your match against ${opponent}`}
              // Under Record it steps back to secondary; on its own it stays primary.
              variant={record ? "secondary" : "primary"}
              onPress={() => router.push(`/league/${leagueId}/score/${match.matchId}`)}
            />
          ) : null}
          {canMessage ? (
            <Button
              label="Message"
              accessibilityLabel={isDoubles ? "Message all four players" : `Message ${opponent}`}
              accessibilityHint={isDoubles ? "Opens one group chat for the four of you" : "Opens a direct chat"}
              variant="secondary"
              loading={openChat.isPending}
              onPress={message}
            />
          ) : null}
        </ButtonRow>
      ) : null}
      {pastDue && recordable === "record" ? (
        <TextLinkButton
          label="Record with Ball Boi"
          accessibilityHint={`Records your match against ${opponent}`}
          onPress={() => openRecorder(router, { matchId: match.matchId, opponentName: opponent, leagueId })}
        />
      ) : null}
    </Card>
  );
}

export default function LeagueScreen() {
  const c = useColors();
  const bottom = useScreenBottomInset();
  const { leagueId: raw, joined } = useLocalSearchParams<{ leagueId: string; joined?: string }>();
  const leagueId = Number(raw);
  // Opened straight from the join sheet (finding 33): "You're in" at the top.
  const justJoined = joined === "1";
  const [tab, setTab] = useState<Tab>("standings");
  const queryClient = useQueryClient();
  const sheet = useActionSheet();
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

  const pull = usePullToRefresh(() => [leagueQ.refetch(), membershipQ.refetch(), standingsQ.refetch(), scheduleQ.refetch(), bracketQ.refetch()]);

  const enterScore = (m: ScheduleMatch) => router.push(`/league/${leagueId}/score/${m.matchId}`);

  if (leagueQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading league" />
      </View>
    );
  }

  const meta = league
    ? [formatLabel(league.format), playTypeLabel(league.leagueType), areaLabel(league.area), league.location].filter(Boolean).join(" · ")
    : "";
  const season =
    league?.startDate && league.endDate ? `Season ${dateRange(league.startDate, league.endDate)}` : null;

  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  // An admin ended it (decision 31), or the season finished. Scores are final (Q9).
  const ended = !!league?.endedAt || league?.status === "completed";
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;
  const isAdmin = !!membershipQ.data?.isAdmin;
  // A round's pairings wait for an admin's review: the gear's dot and the Review line.
  const pairingsWaiting = !!draft && isAdmin && !ended;
  // Decision 79: doubles leagues have no playoffs for now, so no Playoffs tab.
  const doubles = league?.leagueType === "doubles";
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
    // A menu, so a bottom sheet (decision 193).
    sheet.show({
      people: [{ name: slot.player1.playerName }, { name: slot.player2.playerName }],
      message: "The play-by date has passed. Enter the score, or give one player a walkover (W/O).",
      rows: [
        { label: "Enter score", icon: "square.and.pencil", onPress: () => router.push(`/league/${leagueId}/score/${matchId}?settle=1`) },
        { label: `Walkover to ${slot.player1.playerName}`, icon: "flag.checkered", onPress: () => void walkover(slot.player1!) },
        { label: `Walkover to ${slot.player2.playerName}`, icon: "flag.checkered", onPress: () => void walkover(slot.player2!) },
      ],
    });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space4 }}
      scrollIndicatorInsets={bottom.scrollIndicatorInsets}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
    >
      {sheet.element}
      <OfflineNotice pull={pull} />
      {/* The league stays on screen when a refresh fails; the notice above says so (decision 195). */}
      {!league ? (
        <ProblemCard
          title="Can't load this league"
          body="Check your connection and try again."
          onRetry={() => void leagueQ.refetch()}
          retrying={leagueQ.isRefetching}
        />
      ) : (
        <>
          {justJoined ? <JoinedNote leagueName={league.name ?? null} /> : null}
          <View style={{ gap: spacing.space1 }}>
            {/* Chat in the top-right corner (decision 145): the league's chat, also in Messages. */}
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.space3 }}>
              <Text variant="headingM" accessibilityRole="header" style={{ flexShrink: 1 }}>
                {league.name}
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.space2 }}>
                {/* Decision 185: Manage league is the gear, just left of the chat, for admins. */}
                {isAdmin ? (
                  <CornerButton
                    symbol="gearshape"
                    label={manageLeagueLabel(pairingsWaiting)}
                    hint="Opens the admin tools for this league"
                    onPress={() => router.push(`/league/${leagueId}/manage`)}
                  >
                    {pairingsWaiting ? (
                      // The label says it too, so the dot is never the only signal.
                      <View
                        importantForAccessibility="no-hide-descendants"
                        accessibilityElementsHidden
                        pointerEvents="none"
                        style={{ position: "absolute", top: 4, right: 4, width: 10, height: 10, borderRadius: radius.radiusPill, backgroundColor: c.ink }}
                      />
                    ) : null}
                  </CornerButton>
                ) : null}
                <LeagueChatButton leagueId={leagueId} />
              </View>
            </View>
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
            {/* Decision 185: your partner is a line here, not a card. Fixed partners only. */}
            {!ended ? <PartnerLine leagueId={leagueId} /> : null}
            {/* Decision 185: pairings to review is one line with a Review link. */}
            {draft && pairingsWaiting ? (
              <PairingsLine roundNumber={draft.roundNumber} onReview={() => router.push(`/league/${leagueId}/round/${draft.roundId}`)} />
            ) : null}
          </View>

          {/* A team-up request to you is a card only while it waits (decision 185). */}
          {!ended ? <TeamUpRequestCards leagueId={leagueId} /> : null}

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

          {/* D8: doubles pairs no one until 4 players are in, and says so instead of an empty week. */}
          {doubles && !ended && league.playerCount < 4 ? (
            <Card accessible style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}>
              <Icon name="person.2" size={20} tintColor={c.ink} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{`Doubles needs at least 4 players`}</Text>
                <Text variant="small" tone="inkMuted">
                  {`${playersLabel(league.playerCount)} so far. Pairings start once 4 have joined.${isAdmin ? " Share the invite code in Manage league." : ""}`}
                </Text>
              </View>
            </Card>
          ) : null}

          <SegmentedTabs
            label="League sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "standings", label: "Standings" },
              { value: "rounds", label: "Matches" },
              ...(doubles ? [] : [{ value: "playoffs" as const, label: "Playoffs" }]),
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
                {`${standings.some((r) => r.teamId != null) ? "Teams ranked" : "Ranked"} by wins, then head to head.${playoffsNote && !doubles ? ` ${playoffsNote}` : ""}`}
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

          {tab === "playoffs" && !doubles && bracket ? (
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

          {tab === "playoffs" && !doubles && !bracket ? (
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
            // Decision 184: a quiet red text action with a door icon, still confirmed.
            <LeaveAction label="Leave league" busy={leave.isPending} onPress={confirmLeave} />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
