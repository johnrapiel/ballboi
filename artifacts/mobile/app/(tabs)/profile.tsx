import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { useGetMyPlayerCard, useGetMyPlayerMatches } from "@workspace/api-client-react";

import { EmptyTab, MatchTabs } from "@/components/card/MatchTabs";
import { PlayerCard } from "@/components/card/PlayerCard";
import { SeasonRow } from "@/components/card/SeasonRow";
import { CornerButton } from "@/components/CornerButton";
import { ProblemCard } from "@/components/discover/States";
import { OfflineNotice } from "@/components/OfflineNotice";
import { ResultRow } from "@/components/ResultRow";
import { SectionHead } from "@/components/SectionHead";
import { TabScreen } from "@/components/TabHeader";
import { Card, Text } from "@/components/ui";
import { UpcomingRows } from "@/components/UpcomingRows";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { upcomingHint, useOpenUpcoming, useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { recordedLine, recordedThisSeason, tabFromParam, type MatchTab } from "@/lib/playerCard";
import { myResultRows } from "@/lib/resultRow";
import { useServerRecordings } from "@/lib/recording/api";

// Profile is your player card with your matches below it (spec decisions 138
// to 140, John, Nov 8; canvas W2_ProfileCard, W2_ProfileResults):
// 1. The title "Profile", with the glass Settings and Messages buttons.
// 2. The card (design D). Its pencil opens Edit profile; Free times opens
//    the week's hour grid.
// 3. This season: Record, Played, Streak, No-shows. See all opens Career
//    (decision 147).
// 4. Ball Boi this season, with See all opening this season's recordings on
//    the Ball Boi tab. No shot stat has an all-season source that passes its
//    accuracy bar yet (G1), so it shows how many matches you recorded. Hidden
//    with no recordings this season.
// 5. Your matches: Upcoming matches and Results tabs, with no heading. Home's
//    See all and /matches open these, scrolled to the right tab. Results
//    lists every match you played, newest first: league, Discover and Quick
//    match (John, Nov 10), from the same list other players' cards use.
// Sign out lives in Settings.

export default function ProfileScreen() {
  const c = useColors();
  const bottom = useScreenBottomInset({ tab: true });
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; at?: string }>();
  const cardQ = useGetMyPlayerCard();
  const card = cardQ.data;
  const resultsQ = useGetMyPlayerMatches();
  const upcoming = useUpcomingMatches();
  const openUpcoming = useOpenUpcoming();
  const recordings = useServerRecordings();
  const [tab, setTab] = useState<MatchTab>(tabFromParam(params.tab) ?? "upcoming");

  const refetchCard = cardQ.refetch;
  const refetchResults = resultsQ.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // Back from Edit profile, Free times or a score you just entered: show what was just saved.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetchCard();
      void refetchResults();
    }, [refetchCard, refetchResults]),
  );

  // Home's See all and /matches land on the tabs, scrolled to them.
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [tabsY, setTabsY] = useState<number | null>(null);
  const wanted = tabFromParam(params.tab);
  useEffect(() => {
    if (!wanted) return;
    setTab(wanted);
    if (tabsY != null) scroll.current?.scrollTo({ y: Math.max(0, tabsY - spacing.space4), animated: true });
  }, [wanted, params.at, tabsY]);

  const pull = usePullToRefresh(() => [cardQ.refetch(), resultsQ.refetch(), upcoming.refetch(), recordings.refetch()]);

  const results = useMemo(() => myResultRows(resultsQ.data?.results ?? []), [resultsQ.data]);
  const seasonRecordings = card ? recordedThisSeason(recordings.data ?? [], card.season) : [];

  return (
    <TabScreen
      title="Profile"
      action={
        <CornerButton
          symbol="gearshape"
          label="Settings"
          hint="Notifications, Ball Boi recording settings, Discover, Sign out and Delete account"
          onPress={() => router.push("/settings")}
        />
      }
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: bottom.paddingBottom, gap: spacing.space6 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
      >
        <OfflineNotice pull={pull} />
        {cardQ.isLoading ? (
          <View accessible accessibilityLabel="Loading your player card" style={{ height: 320, borderRadius: radius.radiusCard, backgroundColor: c.sand }} />
        ) : !card ? (
          <ProblemCard
            title="Can't load your player card"
            body="Check your connection and try again."
            onRetry={() => void cardQ.refetch()}
            retrying={cardQ.isRefetching}
          />
        ) : (
          <>
            <PlayerCard
              card={card}
              onEdit={() => router.push("/profile/edit")}
              onFreeTimes={() => router.push("/free-times")}
              onAddHomeCourt={() => router.push({ pathname: "/courts", params: { mode: "home" } })}
              onAddPlays={() => router.push("/discover/play")}
            />
            <SeasonRow season={card.season} onSeeAll={() => router.push("/profile/career")} />
            {seasonRecordings.length > 0 ? (
              <View style={{ gap: spacing.space2 }}>
                <SectionHead
                  title="Ball Boi this season"
                  onSeeAll={() => router.navigate({ pathname: "/(tabs)/ballboi", params: { from: card.season.from, to: card.season.to } })}
                  seeAllLabel="See all your Ball Boi recordings this season"
                />
                <Card accessible accessibilityLabel={`Ball Boi this season: ${recordedLine(seasonRecordings.length)}`} style={{ gap: 2 }}>
                  <Text variant="title" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
                    {seasonRecordings.length}
                  </Text>
                  <Text variant="small" tone="inkMuted">
                    {seasonRecordings.length === 1 ? "Match recorded" : "Matches recorded"}
                  </Text>
                </Card>
              </View>
            ) : null}
          </>
        )}

        <View onLayout={(e) => setTabsY(e.nativeEvent.layout.y)} style={{ gap: spacing.space2 }}>
          <MatchTabs tab={tab} onChange={setTab} counts={{ upcoming: upcoming.items.length, results: results.length }} />
          {tab === "upcoming" ? (
            upcoming.isLoading ? (
              <ActivityIndicator color={c.ink} accessibilityLabel="Loading your matches" style={{ marginTop: spacing.space4 }} />
            ) : upcoming.isError && !upcoming.week ? (
              <ProblemCard
                title="Can't load your matches"
                body="Check your connection and try again."
                onRetry={() => void upcoming.refetch()}
                retrying={upcoming.isRefetching}
              />
            ) : upcoming.items.length === 0 ? (
              <EmptyTab title="No upcoming matches" message="Your next league match or a match you set up in Discover shows up here." />
            ) : (
              <UpcomingRows items={upcoming.items} onOpen={openUpcoming} hint={upcomingHint} />
            )
          ) : resultsQ.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading your results" style={{ marginTop: spacing.space4 }} />
          ) : resultsQ.isError && !resultsQ.data ? (
            <ProblemCard
              title="Can't load your results"
              body="Check your connection and try again."
              onRetry={() => void resultsQ.refetch()}
              retrying={resultsQ.isRefetching}
            />
          ) : results.length === 0 ? (
            <EmptyTab title="No results yet" message="Once you or your opponent enters a score, the result shows up here." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {results.map((r, n) => (
                // League, Discover and Quick match results all open Match detail (decision 151).
                <ResultRow key={r.matchId} r={r} last={n === results.length - 1} onPress={() => router.push(`/match/${r.matchId}`)} />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </TabScreen>
  );
}
