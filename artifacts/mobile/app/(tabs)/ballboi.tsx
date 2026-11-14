import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { ProblemCard } from "@/components/discover/States";
import { OfflineNotice } from "@/components/OfflineNotice";
import { DoublesMatchCard } from "@/components/record/DoublesMatchCard";
import { LocalProcessingCard, ServerProcessingCard } from "@/components/record/ProcessingCard";
import { TodaysMatchCard } from "@/components/record/TodaysMatchCard";
import { TabScreen } from "@/components/TabHeader";
import { UpcomingRows } from "@/components/UpcomingRows";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { MATCH_CARD_HINT } from "@/lib/matchActions";
import { splitRecordDay } from "@/lib/matchTiming";
import { matchSourceLabel, useServerRecordings, useTodaysMatches } from "@/lib/recording/api";
import { useQueue, useQueueLoaded } from "@/lib/recording/queue";
import { recordedThisSeason } from "@/lib/playerCard";
import { openRecorder } from "@/lib/recording/start";
import { upcomingFromRecordable } from "@/lib/upcoming";

// Ball Boi tab (spec: Navigation, Ball Boi > Recording).
// "Record a match" starts with the Quick match card, then lists your unplayed
// matches this week (Wave 2 finding 49: Quick match stays at the top however
// many matches there are). Every recording starts from a match.
//
// Record only on match day (finding 64, John, Nov 14): today's matches,
// past-due ones included (decision 197), get the full card with Record with
// Ball Boi. Later matches this week are rows under "Coming up", like Home's
// upcoming rows, and open Match detail; on match day each becomes a full card.
// A league match with no time set is a full card on its play-by day.
//
// From Profile's "Ball Boi this season" See all (decision 138), the tab opens
// with `from` and `to` (YYYY-MM-DD): Your recordings shows only this
// season's, with Show all to see every one again.
export default function BallBoiScreen() {
  const c = useColors();
  const router = useRouter();
  const today = useTodaysMatches();
  const queued = useQueue();
  const queueLoaded = useQueueLoaded();
  // A Quick match already recorded on this phone isn't one to record any more (D6, Q18).
  const recordedHere = new Set(queued.map((r) => r.matchId));
  const matches = (today.data ?? []).filter((m) => m.leagueId != null || !recordedHere.has(m.id));
  const { today: todays, later } = splitRecordDay(matches);
  const comingUp = later.map((m) => upcomingFromRecordable(m, matchSourceLabel(m)));
  const server = useServerRecordings();
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const season = params.from && params.to ? { from: params.from, to: params.to } : null;
  // A recording mid-upload can be in both lists; the phone's copy wins.
  const onPhone = new Set(queued.map((r) => r.sessionId).filter((id) => id != null));
  const allOnServer = (server.data ?? []).filter((r) => !onPhone.has(r.sessionId));
  const onServer = season ? recordedThisSeason(allOnServer, season) : allOnServer;
  const shownQueued = season ? recordedThisSeason(queued, season) : queued;
  // Still waiting for its video, recorded by you, and not on this phone: it
  // can't upload any more, as after a reinstall (D18).
  const lost = (r: (typeof onServer)[number]) => queueLoaded && r.recordedByYou && r.stage === "uploading";
  const pull = usePullToRefresh(() => [today.refetch(), server.refetch()]);
  const serverFailed = server.isError && !server.data;
  // Your recordings scrolls clear of the tab bar (finding 39, decision 194).
  const bottom = useScreenBottomInset({ tab: true });

  return (
    <TabScreen title="Ball Boi">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space6 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />
        }
      >
        <OfflineNotice pull={pull} />
        <View style={{ gap: spacing.space3 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header">
            Record a match
          </Text>

          {/* Quick match comes first, so a long list of matches can't push it down (Wave 2 finding 49). */}
          <Card style={{ gap: spacing.space3 }}>
            <View accessible style={{ gap: spacing.space1 }}>
              <Text variant="bodyStrong">Quick match</Text>
              <Text variant="small" tone="inkMuted">
                A casual hit, or a match outside your leagues. Play anyone, even if they're not on Ball Boi yet.
              </Text>
            </View>
            <Button variant="secondary" label="Quick match" onPress={() => router.push("/record/quick")} />
          </Card>

          {today.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading your matches" />
          ) : today.isError && !today.data ? (
            <ProblemCard
              title="Can't load your matches"
              body="Check your connection and try again."
              onRetry={() => void today.refetch()}
              retrying={today.isRefetching}
            />
          ) : matches.length === 0 ? (
            <Text tone="inkMuted">No matches to record this week.</Text>
          ) : (
            todays.map((m) =>
              m.format === "doubles" ? (
                <DoublesMatchCard key={m.id} match={m} />
              ) : (
                <TodaysMatchCard
                  key={m.id}
                  match={m}
                  onRecord={() => openRecorder(router, { matchId: m.id, opponentName: m.opponentName, leagueId: m.leagueId })}
                />
              ),
            )
          )}
        </View>

        {/* Later this week: rows, no buttons. Nobody records before match day (finding 64). */}
        {!today.isLoading && comingUp.length > 0 ? (
          <View style={{ gap: spacing.space3 }}>
            <Text variant="section" tone="inkMuted" accessibilityRole="header">
              Coming up
            </Text>
            <UpcomingRows items={comingUp} onOpen={(m) => router.push(`/match/${m.matchId}`)} hint={() => MATCH_CARD_HINT} />
          </View>
        ) : null}

        {season || queued.length > 0 || onServer.length > 0 || serverFailed ? (
          <View style={{ gap: spacing.space3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3 }}>
              <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ flexShrink: 1 }}>
                {season ? "Your recordings this season" : "Your recordings"}
              </Text>
              {season ? (
                <Pressable
                  onPress={() => router.setParams({ from: undefined, to: undefined })}
                  accessibilityRole="button"
                  accessibilityLabel="Show all your recordings"
                  style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", alignItems: "flex-end", opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ textDecorationLine: "underline" }}>Show all</Text>
                </Pressable>
              ) : null}
            </View>
            {season && !serverFailed && shownQueued.length === 0 && onServer.length === 0 ? (
              <Text tone="inkMuted">No recordings this season yet.</Text>
            ) : null}
            {[...shownQueued].reverse().map((r) => (
              <LocalProcessingCard key={r.id} rec={r} />
            ))}
            {serverFailed ? (
              // D32: never fail quietly. With recordings on screen, the notice at the top says so instead (decision 195).
              <ProblemCard
                title="Can't load your recordings"
                body="Check your connection and try again."
                onRetry={() => void server.refetch()}
                retrying={server.isRefetching}
              />
            ) : (
              onServer.map((r) => <ServerProcessingCard key={r.sessionId} rec={r} lost={lost(r)} />)
            )}
          </View>
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
