import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";

import {
  useGetLeague,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useGetLeagueSchedule,
  useGetLeagueStandings,
  useGetMyPartner,
  useLeaveLeague,
  useSettlePlayoffMatch,
  type BracketSlot,
} from "@workspace/api-client-react";

import { useActionSheet } from "@/components/ActionSheet";
import { CornerButton } from "@/components/CornerButton";
import { ProblemCard } from "@/components/discover/States";
import { JoinedNote } from "@/components/league/JoinedNote";
import { LeagueChatButton } from "@/components/league/LeagueChatButton";
import { LeagueMatchesTab } from "@/components/league/LeagueMatchesTab";
import { LeagueOverviewTab } from "@/components/league/LeagueOverviewTab";
import { LeagueStandingsTab } from "@/components/league/LeagueStandingsTab";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { OfflineNotice } from "@/components/OfflineNotice";
import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { manageLeagueLabel, partnerLine } from "@/lib/doubles";
import { refreshLeague } from "@/lib/leagueRefresh";
import { aboutRows, LEAGUE_TABS, standingsSummary, type LeagueTab } from "@/lib/leaguePage";
import { playoffLine } from "@/lib/leagueSchedule";

// League (spec: Leagues; Wave 3 decision 210, John's L1 to L10, Nov 14;
// design: "League page: three layouts", row B revised). Above the tabs, on
// every tab: Back (the native header), the league name in Cormorant at 50%
// ink, and the corner buttons: the league chat and, for admins, the gear
// (Manage league) with a dot while pairings need review (L7). Then three
// tabs, Matches, Standings and Overview; Matches opens first, every time.
// - Matches: your match, partner or bye on top, then this round and earlier
//   rounds; the bracket during playoffs (LeagueMatchesTab).
// - Standings: your summary, the table, the tiebreak line (LeagueStandingsTab).
// - Overview: About this league, then Leave league (LeagueOverviewTab).
// The tabs look the same for admins and players, except Invite players before
// the start (L3). Every admin tool is behind the gear. Home's "Round N
// pairings are ready to review" card is how admins hear about pairings first
// (decision 137, L10), so the page has no pairings line.
// All three tabs load with the page, so switching is instant, and one pull to
// refresh on any tab refreshes the page (L8). Switching doesn't animate, so
// there's nothing for Reduce Motion to stop.

export default function LeagueScreen() {
  const c = useColors();
  const bottom = useScreenBottomInset();
  const { leagueId: raw, joined } = useLocalSearchParams<{ leagueId: string; joined?: string }>();
  const leagueId = Number(raw);
  // Opened straight from the join sheet (finding 33): "You're in" at the top.
  const justJoined = joined === "1";
  // L8: the page always opens on Matches.
  const [tab, setTab] = useState<LeagueTab>("matches");
  const queryClient = useQueryClient();
  const sheet = useActionSheet();
  const leave = useLeaveLeague();
  const settle = useSettlePlayoffMatch();

  const leagueQ = useGetLeague(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const standingsQ = useGetLeagueStandings(leagueId);
  const scheduleQ = useGetLeagueSchedule(leagueId);
  const bracketQ = useGetLeagueBracket(leagueId);
  const partnerQ = useGetMyPartner(leagueId);

  const pull = usePullToRefresh(() => [
    leagueQ.refetch(),
    membershipQ.refetch(),
    standingsQ.refetch(),
    scheduleQ.refetch(),
    bracketQ.refetch(),
    partnerQ.refetch(),
  ]);
  // L8: offline, actions that need the server (Accept, Decline, Team up, Leave) are off.
  const offline = pull.notice === "offline";

  // All three tabs load with the page (L8): one spinner, then everything.
  const loading = [leagueQ, membershipQ, standingsQ, scheduleQ, bracketQ, partnerQ].some((q) => q.isLoading);
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading league" />
      </View>
    );
  }

  const league = leagueQ.data;
  const membership = membershipQ.data;
  const myPlayerId = membership?.playerId ?? null;
  const schedule = scheduleQ.data;
  const standings = standingsQ.data ?? [];
  const bracket = bracketQ.data ?? null;
  const partner = partnerQ.data;

  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  // An admin ended it (decision 31), or the season finished. Scores are final (Q9).
  const ended = !!league?.endedAt || league?.status === "completed";
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;
  const isAdmin = !!membership?.isAdmin;
  // A round's pairings wait for an admin's review: the gear's dot and its label (L7).
  const pairingsWaiting = !!draft && isAdmin && !ended;
  const doubles = league?.leagueType === "doubles";
  const fixedPartners = doubles && league?.partnerMode === "fixed";
  // Decision 79: doubles leagues have no playoffs for now, so no playoff line under their standings.
  const playoffsNote = league && !doubles ? playoffLine(league.playoffSize, league.playerCount) : null;
  const summary = standingsSummary({
    standings,
    myPlayerId,
    fixedPartners,
    partnerName: partner?.partner?.name ?? null,
    noPartner: !!partner && !ended && partnerLine(partner)?.kind === "none",
    started,
  });

  // Dropouts (decision 27): played matches stay, the rest are cancelled.
  // Q4: an admin who leaves stops playing but still manages the league.
  // L5: "Leave [league]?", Leave in red, Cancel.
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
    Alert.alert(`Leave ${league.name}?`, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
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
              Alert.alert("Couldn't leave the league", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."),
            ),
      },
    ]);
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
        .catch((e) => Alert.alert("Couldn't enter the result", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."));
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
      {/* The league stays on screen when a refresh fails; the notice says so (decision 195). */}
      <OfflineNotice pull={pull} />
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

          {/* The name, with chat in the top-right corner (decision 145) and, for admins, the gear just left of it. */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.space3 }}>
            <Text variant="headingL" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {league.name}
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.space2 }}>
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

          <SegmentedTabs label="League sections" value={tab} onChange={setTab} tabs={LEAGUE_TABS} />

          <View style={{ paddingTop: spacing.space2 }}>
            {/* L8: the full error with Try again only when a tab has nothing to show. */}
            {tab === "matches" && scheduleQ.isError && !schedule ? (
              <ProblemCard title="Can't load matches" body="Check your connection and try again." onRetry={pull.retry} retrying={pull.retrying} />
            ) : tab === "standings" && standingsQ.isError && !standingsQ.data ? (
              <ProblemCard title="Can't load standings" body="Check your connection and try again." onRetry={pull.retry} retrying={pull.retrying} />
            ) : tab === "matches" ? (
              <LeagueMatchesTab
                league={league}
                leagueId={leagueId}
                schedule={schedule}
                bracket={bracket}
                partner={partner}
                myPlayerId={myPlayerId}
                isAdmin={isAdmin}
                started={started}
                ended={ended}
                offline={offline}
                onSettle={settlePlayoff}
              />
            ) : tab === "standings" ? (
              <LeagueStandingsTab standings={standings} summary={summary} myPlayerId={myPlayerId} started={started} playoffsNote={playoffsNote} />
            ) : (
              <LeagueOverviewTab
                rows={aboutRows(league, schedule?.today ?? null)}
                canLeave={!!membership?.isPlaying && !ended}
                leaving={leave.isPending}
                offline={offline}
                onLeave={confirmLeave}
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}
