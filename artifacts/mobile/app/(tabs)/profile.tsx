import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyPlayerCard } from "@workspace/api-client-react";

import { EmptyTab, MatchTabs } from "@/components/card/MatchTabs";
import { PlayerCard } from "@/components/card/PlayerCard";
import { SeasonRow } from "@/components/card/SeasonRow";
import { CornerButton } from "@/components/CornerButton";
import { ResultRow } from "@/components/ResultRow";
import { SectionHead } from "@/components/SectionHead";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { UpcomingRows } from "@/components/UpcomingRows";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { upcomingHint, useOpenUpcoming, useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { recordedLine, recordedThisSeason, tabFromParam, type MatchTab } from "@/lib/playerCard";
import { useServerRecordings } from "@/lib/recording/api";

// Profile is your player card with your matches below it (spec decisions 138
// to 140, John, Nov 8; canvas W2_ProfileCard, W2_ProfileResults):
// 1. The title "Profile", with the glass Settings and Messages buttons.
// 2. The card (design D). Its pencil opens Edit profile; Free times opens
//    the week's hour grid.
// 3. This season: Record, Played, Streak, No-shows.
// 4. Ball Boi this season, with See all opening this season's recordings on
//    the Ball Boi tab. No shot stat has an all-season source that passes its
//    accuracy bar yet (G1), so it shows how many matches you recorded. Hidden
//    with no recordings this season.
// 5. Your matches: Upcoming matches and Results tabs, with no heading. Home's
//    See all and /matches open these, scrolled to the right tab.
// Sign out lives in Settings.

export default function ProfileScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; at?: string }>();
  const cardQ = useGetMyPlayerCard();
  const card = cardQ.data;
  const upcoming = useUpcomingMatches();
  const openUpcoming = useOpenUpcoming();
  const recordings = useServerRecordings();
  const [tab, setTab] = useState<MatchTab>(tabFromParam(params.tab) ?? "upcoming");

  const refetchCard = cardQ.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // Back from Edit profile or Free times: show what was just saved.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetchCard();
    }, [refetchCard]),
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

  const refresh = () => {
    void cardQ.refetch();
    upcoming.refetch();
    void recordings.refetch();
  };

  const results = upcoming.week?.results ?? [];
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
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: insets.bottom + 96, gap: spacing.space6 }}
        refreshControl={<RefreshControl refreshing={cardQ.isRefetching || upcoming.isRefetching} onRefresh={refresh} tintColor={c.ink} />}
      >
        {cardQ.isLoading ? (
          <View accessible accessibilityLabel="Loading your player card" style={{ height: 320, borderRadius: radius.radiusCard, backgroundColor: c.sand }} />
        ) : !card ? (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong" accessibilityRole="alert">
              {isOfflineError(cardQ.error) ? OFFLINE_MESSAGE : "Couldn't load your player card"}
            </Text>
            <Button label="Try again" variant="secondary" loading={cardQ.isRefetching} onPress={() => void cardQ.refetch()} />
          </Card>
        ) : (
          <>
            <PlayerCard card={card} onEdit={() => router.push("/profile/edit")} onFreeTimes={() => router.push("/free-times")} />
            <SeasonRow season={card.season} />
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
          {upcoming.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading your matches" style={{ marginTop: spacing.space4 }} />
          ) : upcoming.isError && !upcoming.week ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your matches</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : tab === "upcoming" ? (
            upcoming.items.length === 0 ? (
              <EmptyTab title="No upcoming matches" message="Your next league match or a match you set up in Discover shows up here." />
            ) : (
              <UpcomingRows items={upcoming.items} onOpen={openUpcoming} hint={upcomingHint} />
            )
          ) : results.length === 0 ? (
            <EmptyTab title="No results yet" message="Once you or your opponent enters a score, the result shows up here." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {results.map((r, n) => (
                <ResultRow key={r.matchId} r={r} last={n === results.length - 1} onPress={() => router.push(`/match/${r.matchId}`)} />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </TabScreen>
  );
}
